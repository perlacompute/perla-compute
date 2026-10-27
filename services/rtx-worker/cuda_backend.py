"""Bounded ctypes interface. Missing/unsupported GPUs fail; never CPU fallback."""
import ctypes as C
import json
from pathlib import Path
import numpy as np


class CudaBackend:
    def __init__(self, device=0, k=2048, library=None):
        if type(device) is not int or not 0 <= device < 64 or k not in (2048, 4096):
            raise ValueError("Invalid GPU index or K")
        path = Path(library) if library else Path(__file__).with_name("libperla_rtx.so")
        try:
            self.lib = C.CDLL(str(path.resolve()))
        except OSError:
            raise RuntimeError("CUDA backend unavailable. Build the RTX image and pass a supported GPU with --gpus") from None
        lib = self.lib
        lib.perla_cuda_abi.restype = C.c_int
        if lib.perla_cuda_abi() != 1:
            raise RuntimeError("Unexpected CUDA backend ABI")
        lib.perla_cuda_device_info.argtypes = [C.c_int, C.c_char_p, C.c_int]
        lib.perla_cuda_device_info.restype = C.c_int
        lib.perla_cuda_open.argtypes = [C.c_int, C.c_int, C.POINTER(C.c_void_p), C.c_char_p, C.c_int]
        lib.perla_cuda_open.restype = C.c_int
        lib.perla_cuda_close.argtypes = [C.c_void_p]
        lib.perla_cuda_close.restype = None
        lib.perla_cuda_compute.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_float), C.c_char_p, C.c_int]
        lib.perla_cuda_compute.restype = C.c_int
        buf = C.create_string_buffer(1024)
        if lib.perla_cuda_device_info(device, buf, len(buf)):
            raise RuntimeError("CUDA device unavailable: " + buf.value.decode(errors="replace"))
        self.info = json.loads(buf.value)
        if self.info.get("computeCapability") not in (86, 89, 120):
            raise RuntimeError("RTX build targets sm86 (30 series), sm89 (40 series), sm120 (50 series)")
        self.k = k
        self.handle = C.c_void_p()
        if lib.perla_cuda_open(device, k, C.byref(self.handle), buf, len(buf)):
            raise RuntimeError("CUDA initialization failed: " + buf.value.decode(errors="replace"))

    def compute(self, an, btn):
        for a in (an, btn):
            if a.shape != (128, self.k) or a.dtype != np.int8 or not a.flags.c_contiguous:
                raise ValueError("CUDA input must be contiguous 128-by-K int8")
        if not self.handle:
            raise RuntimeError("CUDA backend is closed")
        c, tr = np.empty((128, 128), np.int32), np.empty((512, 16), np.uint32)
        ms, err = C.c_float(), C.create_string_buffer(1024)
        rc = self.lib.perla_cuda_compute(self.handle, an.ctypes.data, btn.ctypes.data, c.ctypes.data, tr.ctypes.data, C.byref(ms), err, len(err))
        if rc:
            raise RuntimeError("CUDA computation failed: " + err.value.decode(errors="replace"))
        return c, tr, ms.value

    def close(self):
        if getattr(self, "handle", None):
            self.lib.perla_cuda_close(self.handle)
            self.handle = C.c_void_p()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
