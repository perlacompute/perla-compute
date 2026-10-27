// Perla portable dense INT8 Tensor Core backend, MIT.
// Fixed validation profile: M=N=128, rank=128, K=2048 or 4096.
// Uses WMMA, rather than Hopper-only WGMMA/TMA. Build for sm86/sm89/sm120.
#include <cuda_runtime.h>
#include <mma.h>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>

namespace {
constexpr int side = 128, rank = 128, tiles = 512, words = 16;
void check(cudaError_t code) {
    if (code != cudaSuccess) throw std::runtime_error(cudaGetErrorString(code));
}
void error_text(char* out, int length, const char* message) {
    if (out && length > 0) std::snprintf(out, static_cast<size_t>(length), "%s", message);
}
struct Context {
    int device, k;
    int8_t *a = nullptr, *bt = nullptr;
    int32_t* c = nullptr;
    uint32_t* transcripts = nullptr;
    cudaEvent_t start = nullptr, end = nullptr;
    ~Context() {
        cudaSetDevice(device);
        if (start) cudaEventDestroy(start);
        if (end) cudaEventDestroy(end);
        if (a) cudaFree(a);
        if (bt) cudaFree(bt);
        if (c) cudaFree(c);
        if (transcripts) cudaFree(transcripts);
    }
};

__global__ void partial_gemm(const int8_t* a, const int8_t* bt,
                             int32_t* c, int k, int offset) {
    // Four warps compute four independent 16x16 output tiles per block.
    using namespace nvcuda;
    const int tile = blockIdx.x * 4 + threadIdx.x / 32;
    const int row = (tile / 8) * 16, col = (tile % 8) * 16;
    wmma::fragment<wmma::matrix_a, 16, 16, 16, signed char, wmma::row_major> fa;
    wmma::fragment<wmma::matrix_b, 16, 16, 16, signed char, wmma::col_major> fb;
    wmma::fragment<wmma::accumulator, 16, 16, 16, int> acc;
    wmma::load_matrix_sync(acc, c + row * side + col, side, wmma::mem_row_major);
    // B is transposed on the host: BT[col,k] is B[k,col], column-major.
    for (int p = offset; p < offset + rank; p += 16) {
        wmma::load_matrix_sync(fa, a + row * k + p, k);
        wmma::load_matrix_sync(fb, bt + col * k + p, k);
        wmma::mma_sync(acc, fa, fb, acc);
    }
    wmma::store_matrix_sync(c + row * side + col, acc, side, wmma::mem_row_major);
}

__global__ void fold_transcripts(const int32_t* c, uint32_t* out, int chunk) {
    const int tile = blockIdx.x * blockDim.x + threadIdx.x;
    if (tile >= tiles) return;
    const int ri = tile / 16, ci = tile % 16;
    const int ro = (ri & 7) | ((ri & 24) << 1);
    const int co = ((ci & 3) << 1) | ((ci & 4) << 2) | ((ci & 8) << 3);
    // These patterns partition the full 128x128 output exactly once.
    const int rp[4] = {0, 8, 64, 72};
    const int cp[8] = {0, 1, 8, 9, 32, 33, 40, 41};
    uint32_t hash = 0;
    for (int r = 0; r < 4; ++r)
        for (int col = 0; col < 8; ++col)
            hash ^= static_cast<uint32_t>(c[(ro + rp[r]) * side + co + cp[col]]);
    uint32_t& word = out[tile * words + (chunk & 15)];
    word = ((word << 13) | (word >> 19)) ^ hash;
}
} // namespace

extern "C" {
int perla_cuda_abi() { return 1; }
int perla_cuda_device_info(int device, char* out, int length) {
    try {
        check(cudaSetDevice(device));
        cudaDeviceProp p{};
        check(cudaGetDeviceProperties(&p, device));
        int driver = 0, runtime = 0;
        check(cudaDriverGetVersion(&driver)); check(cudaRuntimeGetVersion(&runtime));
        // CUDA device names are supplied by the driver; JSON-escape for safety.
        std::string escaped;
        for (const char* q = p.name; *q; ++q) {
            if (*q == '"' || *q == '\\') escaped += '\\';
            if (static_cast<unsigned char>(*q) >= 32) escaped += *q;
        }
        std::snprintf(out, static_cast<size_t>(length),
            "{\"name\":\"%s\",\"computeCapability\":%d,\"memoryBytes\":%llu,\"driverVersion\":%d,\"runtimeVersion\":%d}",
            escaped.c_str(), p.major * 10 + p.minor,
            static_cast<unsigned long long>(p.totalGlobalMem), driver, runtime);
        return 0;
    } catch (const std::exception& e) { error_text(out, length, e.what()); return 1; }
}
int perla_cuda_open(int device, int k, void** result, char* err, int errlen) {
    if (!result) return 1;
    *result = nullptr;
    try {
        if (k != 2048 && k != 4096) throw std::runtime_error("K must be 2048 or 4096");
        check(cudaSetDevice(device));
        cudaDeviceProp p{}; check(cudaGetDeviceProperties(&p, device));
        const int arch = p.major * 10 + p.minor;
        if (arch != 86 && arch != 89 && arch != 120)
            throw std::runtime_error("This RTX build targets sm86, sm89 and sm120 only");
        auto ctx = std::make_unique<Context>(); ctx->device = device; ctx->k = k;
        check(cudaMalloc(&ctx->a, side * k));
        check(cudaMalloc(&ctx->bt, side * k));
        check(cudaMalloc(&ctx->c, side * side * sizeof(int32_t)));
        check(cudaMalloc(&ctx->transcripts, tiles * words * sizeof(uint32_t)));
        check(cudaEventCreate(&ctx->start)); check(cudaEventCreate(&ctx->end));
        *result = ctx.release(); return 0;
    } catch (const std::exception& e) { error_text(err, errlen, e.what()); return 1; }
}
void perla_cuda_close(void* handle) { delete static_cast<Context*>(handle); }
int perla_cuda_compute(void* handle, const int8_t* a, const int8_t* bt,
                       int32_t* c, uint32_t* tr, float* milliseconds,
                       char* err, int errlen) {
    try {
        if (!handle || !a || !bt || !c || !tr || !milliseconds)
            throw std::runtime_error("Invalid CUDA argument");
        auto& ctx = *static_cast<Context*>(handle);
        check(cudaSetDevice(ctx.device));
        check(cudaMemcpy(ctx.a, a, side * ctx.k, cudaMemcpyHostToDevice));
        check(cudaMemcpy(ctx.bt, bt, side * ctx.k, cudaMemcpyHostToDevice));
        check(cudaMemset(ctx.c, 0, side * side * sizeof(int32_t)));
        check(cudaMemset(ctx.transcripts, 0, tiles * words * sizeof(uint32_t)));
        check(cudaEventRecord(ctx.start));
        for (int offset = 0; offset < ctx.k; offset += rank) {
            partial_gemm<<<16, 128>>>(ctx.a, ctx.bt, ctx.c, ctx.k, offset);
            check(cudaGetLastError());
            fold_transcripts<<<4, 128>>>(ctx.c, ctx.transcripts, offset / rank);
            check(cudaGetLastError());
        }
        check(cudaEventRecord(ctx.end)); check(cudaEventSynchronize(ctx.end));
        check(cudaEventElapsedTime(milliseconds, ctx.start, ctx.end));
        check(cudaMemcpy(c, ctx.c, side * side * sizeof(int32_t), cudaMemcpyDeviceToHost));
        check(cudaMemcpy(tr, ctx.transcripts, tiles * words * sizeof(uint32_t), cudaMemcpyDeviceToHost));
        return 0;
    } catch (const std::exception& e) { error_text(err, errlen, e.what()); return 1; }
}
} // extern C
