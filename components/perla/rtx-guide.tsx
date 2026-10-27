import Link from 'next/link';
import { ArrowUpRight, Download } from 'lucide-react';
import { CopyButton, Pill } from '@/components/auren/shared';

function Code({ value }: { value: string }) {
  return <div className="perla-code"><div><span>GPU host terminal</span><CopyButton value={value}/></div><pre><code>{value}</code></pre></div>;
}

export function RtxGuide() {
  return <>
    <span className="eyebrow">RTX WORKER / 0.5.0</span>
    <h2>RTX 30, 40 and 50.<br/><em>One matrix-mining path.</em></h2>
    <Pill tone="coral">Physical GPU validation required</Pill>
    <p>The experimental worker includes native CUDA targets for all three families. It performs standalone dense INT8 matrix mining and produces the same certificate-v3 PlainProof checked by Perla. It does not load a model checkpoint or serve AI inference.</p>
    <div className="table-scroll"><table><thead><tr><th>Family</th><th>CUDA target</th><th>Current evidence</th></tr></thead><tbody>
      <tr><td>RTX 30 series</td><td>sm86 · 8.6</td><td>Build target included; GPU run required</td></tr>
      <tr><td>RTX 40 series</td><td>sm89 · 8.9</td><td>Build target included; GPU run required</td></tr>
      <tr><td>RTX 50 series</td><td>sm120 · 12.0</td><td>Build target included; GPU run required</td></tr>
    </tbody></table></div>
    <p>Use Linux x86-64, Docker Buildx, NVIDIA Container Toolkit and a driver compatible with CUDA 13.1. Build and run this on the GPU host. The website VPS does not supply GPU capacity.</p>
    <div className="portal-actions"><a className="button button-dark button-small" href="/downloads/perla-rtx-worker.tar.gz" download><Download size={14}/>RTX worker package</a><a className="arrow-link" href="/downloads/SHA256SUMS" download>Package checksums<Download size={14}/></a></div>
    <h3>1. Verify the package and build.</h3>
    <p>Place the archive and checksum list in the same folder. The build compiles the three CUDA targets and obtains the pinned native proof library. It does not need a worker credential.</p>
    <Code value={'sha256sum --ignore-missing -c SHA256SUMS\ntar -xzf perla-rtx-worker.tar.gz\ncd perla-rtx-worker\nbash setup-worker.sh'}/>
    <h3>2. Run the offline GPU gate.</h3>
    <Code value={'nvidia-smi --query-gpu=index,name,memory.total,compute_cap,driver_version --format=csv\ndocker run --rm --gpus all perla-rtx-worker:0.5.0 selftest --device 0 > gpu-validation.json'}/>
    <p>The command must exit successfully and report <code>gpuSelfTestPassed: true</code>. It compares the full GPU result and all transcripts with an independent CPU oracle, then checks native proof acceptance, a failing PoW and a changed challenge. Both K2048 and K4096 are tested. It contacts no coordinator and creates no credit. Each target family needs its own physical-host report.</p>
    <h3>3. Follow one accepted contribution.</h3>
    <p>After the GPU gate passes and the operator permits a controlled test, put your downloaded <code>worker.env</code> in this folder. The miner repeats a GPU check before requesting work. Paused admission exits without submitting a proof.</p>
    <Code value={'chmod 600 worker.env\ndocker run --rm --gpus all --env-file worker.env \\\n  perla-rtx-worker:0.5.0 run --device 0 --shares 1'}/>
    <p>A confirmed <code>accepted_share</code> log contains a receipt and Explorer link. Check it against the signed-in account. The preview stops after one accepted share by default; it has no CPU mining fallback. The package README covers selected devices, supervised runs, failures and the remaining release gates.</p>
    <p className="portal-caption">This is a correctness preview. No Perla GPU hashrate, earnings, useful customer AI workload or complete hardware-family validation is established by a successful software build. V4 uses bounded, non-saturating difficulty profiles; actual GPU share arrival times must still be measured before public mining.</p>
    <Link className="arrow-link" href="/explorer">Open Proof Explorer<ArrowUpRight size={14}/></Link>
  </>;
}
