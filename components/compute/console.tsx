"use client";
import { useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  parseAbi,
  parseUnits,
  formatUnits,
  decodeEventLog,
} from "viem";
import {
  ArrowUpRight,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  Play,
  Square,
  Wallet,
  LoaderCircle,
  Search,
  ArrowRight,
} from "lucide-react";
import { getProvider } from "@/components/auren/shared";
import styles from "./console.module.css";
import { workerCommand } from "@/lib/compute/commands.mjs";
type Data = Record<string, any>;
type Model = {
  id: string;
  name: string;
  owned_by?: string;
  kind: string;
  available: boolean;
  pricing?: { inputPerMillion: number; outputPerMillion: number };
  priceMicros?: number;
  maxOutput?: number;
  independentWallets?: number;
};
const tabs = ["Mining", "Convert", "Explorer"];
const money = (n: number) => "$" + (Number(n || 0) / 1000000).toFixed(6);
const perl = (n: string | number = "0") =>
  Number(formatUnits(BigInt(n || "0"), 18)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
const short = (s: string = "") =>
  s.length > 16 ? s.slice(0, 8) + "…" + s.slice(-6) : s;
const when = (n: number) => new Date(n * 1000).toLocaleString();
async function api(path: string, options: RequestInit = {}) {
  const r = await fetch("/api/compute/" + path, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(
      new Error(data.error?.message || data.error || "Request failed"),
      { status: r.status, code: data.error?.code },
    );
  return data;
}
function CopyText({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`${styles.btn} ${styles.secondary} ${styles.small}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}{" "}
      {done ? "Copied" : label}
    </button>
  );
}
const tokenAbi = parseAbi(["function approve(address,uint256) returns(bool)"]);
const creditAbi = parseAbi([
  "function buyCredits(address,uint256,uint256,uint256)",
  "function buyUSDGCredits(address,uint256,uint256)",
  "event USDGCreditPurchased(address indexed payer,address indexed beneficiary,uint256 tokenAmount,uint256 creditMicros)",
  "event CreditPurchased(address indexed payer,address indexed beneficiary,uint256 tokenAmount,uint256 creditMicros,uint256 rateNonce)",
]);
const rewardAbi = parseAbi([
  "function claimMining(uint256,uint256,address,uint256,bytes32[])",
  "function claimMigration(uint256,address,uint256,uint256,bytes32[])",
]);

export function ComputeConsole() {
  const [tab, setTab] = useState("Mining"),
    [status, setStatus] = useState<Data | null>(null),
    [account, setAccount] = useState<Data | null>(null),
    [models, setModels] = useState<Model[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [newKey, setNewKey] = useState(""),
    [keyName, setKeyName] = useState("My application"),
    [daily, setDaily] = useState("10"),
    [monthly, setMonthly] = useState("100"),
    [keyScope, setKeyScope] = useState("chat,jobs"),
    [keyModels, setKeyModels] = useState("*"),
    [keyRpm, setKeyRpm] = useState("30"),
    [keyConcurrency, setKeyConcurrency] = useState("2"),
    [messages, setMessages] = useState<{ role: string; content: string }[]>([]),
    [prompt, setPrompt] = useState(""),
    [sending, setSending] = useState(false),
    [quote, setQuote] = useState<Data | null>(null),
    [amount, setAmount] = useState(""),
    [usdGAmount, setUsdGAmount] = useState("5"),
    [paymentHash, setPaymentHash] = useState(""),
    [useFree, setUseFree] = useState(true),
    [pending, setPending] = useState<Data | null>(null),
    [allocations, setAllocations] = useState<Data[]>([]),
    [migration, setMigration] = useState<Data | null>(null),
    [migrateAmount, setMigrateAmount] = useState(""),
    [reconnect, setReconnect] = useState(""),
    [code, setCode] = useState(""),
    [workerName, setWorkerName] = useState("rig01"),
    [device, setDevice] = useState("0"),
    [jobModel, setJobModel] = useState(""),
    [jobPrompt, setJobPrompt] = useState(""),
    [job, setJob] = useState<Data | null>(null),
    [explorer, setExplorer] = useState<Data | null>(null),
    [receipt, setReceipt] = useState<Data | null>(null);
  const stop = useRef<AbortController | null>(null);
  const changeTab = (name: string) => {
    setTab(name);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", name.toLowerCase().replaceAll(" ", "-"));
    window.history.replaceState({}, "", u);
  };
  const refresh = async () => {
    const [state, catalog] = await Promise.all([api("status"), api("models")]);
    setStatus(state);
    setModels(catalog.data || []);
    setSelected(
      (old) =>
        old || catalog.data?.find((m: Model) => m.kind === "chat")?.id || "",
    );
    setJobModel(
      (old) =>
        old || catalog.data?.find((m: Model) => m.kind === "gpu-job")?.id || "",
    );
    try {
      setAccount(await api("account"));
    } catch (e: any) {
      if (e.status !== 401) throw e;
      setAccount(null);
    }
  };
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "Operation could not be completed");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const params = new URLSearchParams(window.location.search);
    const requested = tabs.find(
      (t) => t.toLowerCase().replaceAll(" ", "-") === params.get("tab"),
    );
    if (requested) setTab(requested);
    if (params.get("receipt")) {
      setTab("Explorer");
      void api("public/receipt/" + encodeURIComponent(params.get("receipt")!))
        .then(setReceipt)
        .catch((e) => setError(e.message));
    }
    if (params.get("reconnect")) {
      setReconnect(params.get("reconnect")!);
      setTab("Mining");
    }
    const p = getProvider();
    const changed = () => {
      setAccount(null);
      setUseFree(true);
      setPending(null);
      stop.current?.abort();
      setNewKey("");
      setMessages([]);
      void api("auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    };
    p?.on?.("accountsChanged", changed);
    return () => {
      p?.removeListener?.("accountsChanged", changed);
      stop.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (tab === "Explorer")
      void api("public/explorer")
        .then(setExplorer)
        .catch((e) => setError(e.message));
    if (tab === "Convert" && account) {
      void api("quote")
        .then(setQuote)
        .catch(() => setQuote(null));
      void api("migration")
        .then((m) => {
          setMigration(m);
          if (m.remainingBaseUnits) {
            const limit =
              BigInt(m.remainingBaseUnits) < BigInt(m.dailyRemainingBaseUnits)
                ? BigInt(m.remainingBaseUnits)
                : BigInt(m.dailyRemainingBaseUnits);
            setMigrateAmount(formatUnits(limit, 18));
          }
        })
        .catch((e) => setError(e.message));
    }
    if (tab === "Mining" && account)
      void api("rewards")
        .then((d) => setAllocations(d.allocations))
        .catch((e) => setError(e.message));
  }, [tab, account?.address]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.state)) return;
    const timer = setInterval(() => {
      void api("jobs/" + job.id)
        .then(setJob)
        .catch((e) => setError(e.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.id, job?.state]);
  useEffect(() => {
    if (!account) return;
    try {
      const item = JSON.parse(
        localStorage.getItem("perla-credit-payment") || "null",
      );
      if (item?.address === account.address) setPending(item);
    } catch {}
  }, [account?.address]);
  const signIn = () =>
    action(async () => {
      const p = getProvider();
      if (!p) throw Error("Open this console in an EVM wallet browser.");
      const accounts = (await p.request({
        method: "eth_requestAccounts",
      })) as string[];
      const ch = await api("auth/challenge", {
        method: "POST",
        body: JSON.stringify({ address: accounts[0] }),
      });
      const hex =
        "0x" +
        Array.from(new TextEncoder().encode(ch.message), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join("");
      const signature = await p.request({
        method: "personal_sign",
        params: [hex, accounts[0]],
      });
      await api("auth/verify", {
        method: "POST",
        body: JSON.stringify({ id: ch.id, signature }),
      });
      await refresh();
    });
  async function walletReady() {
    const p = getProvider();
    if (!p || !account) throw Error("Sign in with your wallet first.");
    const addresses = (await p.request({ method: "eth_accounts" })) as string[];
    if (addresses[0]?.toLowerCase() !== account.address)
      throw Error("Select the wallet that signed into this console.");
    if ((await p.request({ method: "eth_chainId" })) !== "0x1237") {
      try {
        await p.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x1237" }],
        });
      } catch (e: any) {
        if (e.code !== 4902) throw e;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x1237",
              chainName: "Robinhood Chain",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
              blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
            },
          ],
        });
      }
    }
    return p;
  }
  async function transact(
    to: string,
    data: `0x${string}`,
    onSubmitted?: (hash: string) => void,
  ) {
    const p = await walletReady(),
      hash = (await p.request({
        method: "eth_sendTransaction",
        params: [{ from: account!.address, to, data }],
      })) as string;
    onSubmitted?.(hash);
    setNotice("Transaction submitted: " + hash);
    for (let n = 0; n < 90; n++) {
      const r = (await p.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as Data | null;
      if (r) {
        if (r.status !== "0x1") throw Error("Transaction reverted.");
        return { hash, receipt: r };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw Error(
      "Transaction is still pending. Follow its hash in the explorer before submitting again.",
    );
  }
  const buyCredits = () =>
    action(async () => {
      if (
        pending ||
        !quote?.active ||
        !status?.active ||
        !status.features.convert
      )
        throw Error("Credit purchases are not open.");
      const units = parseUnits(amount, 18),
        credits = (units * BigInt(quote.rateMicros)) / 10n ** 18n;
      if (units <= 0n || credits <= 0n)
        throw Error("Enter a positive PERL amount.");
      await transact(
        quote.token,
        encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [quote.vault, units],
        }),
      );
      const tx = await transact(
        quote.vault,
        encodeFunctionData({
          abi: creditAbi,
          functionName: "buyCredits",
          args: [account!.address, units, credits, BigInt(quote.nonce)],
        }),
        (hash) => {
          const item = { hash, logIndex: null, address: account!.address };
          setPending(item);
          localStorage.setItem("perla-credit-payment", JSON.stringify(item));
        },
      );
      const log = tx.receipt.logs.find((l: Data) => {
        if (l.address.toLowerCase() !== quote.vault.toLowerCase()) return false;
        try {
          return (
            decodeEventLog({ abi: creditAbi, data: l.data, topics: l.topics })
              .eventName === "CreditPurchased"
          );
        } catch {
          return false;
        }
      });
      if (!log)
        throw Error(
          "Purchase event was not found. Preserve the transaction hash.",
        );
      const item = {
        hash: tx.hash,
        logIndex: Number(BigInt(log.logIndex)),
        address: account!.address,
      };
      setPending(item);
      localStorage.setItem("perla-credit-payment", JSON.stringify(item));
      setNotice(
        "Purchase confirmed. Credits will appear after chain finality.",
      );
    });
  const confirmCredits = () =>
    action(async () => {
      await api("deposits/confirm", {
        method: "POST",
        body: JSON.stringify(pending),
      });
      localStorage.removeItem("perla-credit-payment");
      setPending(null);
      setNotice("Credits confirmed and added to your account.");
      await refresh();
    });
  const buyUSDGCredits = () =>
    action(async () => {
      if (
        !account ||
        !status?.active ||
        !status.features.usdg ||
        !quote?.usdg?.active ||
        pending
      )
        throw Error(
          "USDG top-ups are unavailable or another payment is pending.",
        );
      if (!/^\d+(?:\.\d{1,6})?$/.test(usdGAmount))
        throw Error(
          "Enter a positive USDG amount with up to 6 decimal places.",
        );
      const units = parseUnits(usdGAmount, 6);
      if (units <= 0n || units > 1_000_000_000_000n)
        throw Error(
          "Enter a USDG amount above zero and no more than 1,000,000.",
        );
      await transact(
        quote.usdg.token,
        encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [quote.usdg.vault, units],
        }),
      );
      const tx = await transact(
        quote.usdg.vault,
        encodeFunctionData({
          abi: creditAbi,
          functionName: "buyUSDGCredits",
          args: [account.address, units, units],
        }),
        (hash) => {
          const item = {
            hash,
            logIndex: null,
            address: account.address,
            asset: "USDG",
          };
          setPending(item);
          localStorage.setItem("perla-credit-payment", JSON.stringify(item));
        },
      );
      setNotice("USDG payment confirmed. Check finality to add your credits.");
      try {
        await api("deposits/confirm", {
          method: "POST",
          body: JSON.stringify({ hash: tx.hash, logIndex: null }),
        });
        setPending(null);
        localStorage.removeItem("perla-credit-payment");
        setNotice("USDG credits added.");
        await refresh();
      } catch {
        setNotice(
          "Payment submitted. Credits will appear after chain finality; check this payment again.",
        );
      }
    });
  const recoverPayment = () =>
    action(async () => {
      const hash = paymentHash.trim();
      await api("deposits/confirm", {
        method: "POST",
        body: JSON.stringify({ hash, logIndex: null }),
      });
      if (pending?.hash?.toLowerCase() === hash.toLowerCase()) {
        setPending(null);
        localStorage.removeItem("perla-credit-payment");
      }
      setNotice(
        "Finalized payment checked; credits are recorded exactly once.",
      );
      await refresh();
    });
  const send = async () => {
    if (!prompt.trim() || sending) return;
    if (useFree && (!account?.trial?.enabled || account.trial.remaining <= 0)) {
      setError(
        "Your free chats are used. Add credits and choose Use credits to continue.",
      );
      return;
    }
    const next = [...messages, { role: "user", content: prompt.trim() }];
    setPrompt("");
    setMessages([...next, { role: "assistant", content: "" }]);
    setSending(true);
    setError("");
    const controller = new AbortController();
    stop.current = controller;
    try {
      const r = await fetch("/api/compute/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          model: selected,
          messages: next,
          max_tokens: useFree ? account?.trial?.maxOutput || 256 : 1024,
          billing_mode: useFree ? "trial" : "credits",
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const d = await r.json();
        setMessages(messages);
        setPrompt(next[next.length - 1].content);
        throw Error(d.error?.message || "Request failed");
      }
      const reader = r.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        answer = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const text = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (!text || text === "[DONE]") continue;
          const d = JSON.parse(text);
          if (d.error) throw Error(d.error.message);
          answer += d.choices?.[0]?.delta?.content || "";
          setMessages([...next, { role: "assistant", content: answer }]);
        }
      }
    } catch (e: any) {
      setError(
        e.name === "AbortError"
          ? "Request stopped. Check Usage for any credits awaiting reconciliation."
          : e.message,
      );
    } finally {
      setSending(false);
      stop.current = null;
      void refresh().catch(() => {});
    }
  };
  const createApiKey = () =>
    action(async () => {
      const d = await api("keys", {
        method: "POST",
        body: JSON.stringify({
          name: keyName,
          dailyLimitMicros: Math.round(Number(daily) * 1000000),
          monthlyLimitMicros: Math.round(Number(monthly) * 1000000),
          models: keyModels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          scopes: keyScope.split(","),
          rpm: Number(keyRpm),
          concurrency: Number(keyConcurrency),
        }),
      });
      setNewKey(d.key);
      await refresh();
    });
  const claimMining = (a: Data) =>
    action(async () => {
      await transact(
        a.vault,
        encodeFunctionData({
          abi: rewardAbi,
          functionName: "claimMining",
          args: [
            BigInt(a.epoch),
            BigInt(a.index),
            a.address,
            BigInt(a.amount),
            a.proof,
          ],
        }),
      );
      setNotice("Reward claim confirmed.");
      const d = await api("rewards");
      setAllocations(d.allocations);
      await refresh();
    });
  const claimMigration = () =>
    action(async () => {
      if (!migration) throw Error("No eligible migration allocation.");
      const n = parseUnits(migrateAmount, 18);
      if (
        n <= 0n ||
        n > BigInt(migration.remainingBaseUnits) ||
        n > BigInt(migration.dailyRemainingBaseUnits)
      )
        throw Error(
          "Choose an amount within your remaining allocation and the global daily limit.",
        );
      await transact(
        migration.vault,
        encodeFunctionData({
          abi: rewardAbi,
          functionName: "claimMigration",
          args: [
            BigInt(migration.index),
            migration.address,
            BigInt(migration.amount),
            n,
            migration.proof,
          ],
        }),
      );
      setMigration(await api("migration"));
      setNotice("Migration claim confirmed.");
    });
  const command = workerCommand(
    status?.workerRelease,
    account?.address,
    workerName,
    device,
  );
  const filtered = models.filter((m) =>
      (m.name + " " + m.owned_by).toLowerCase().includes(search.toLowerCase()),
    ),
    balance = account?.usage;
  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <div>
          <span className={styles.eyebrow}>PERLA / MAINNET</span>
          <h1>Your mining workspace.</h1>
          <p className={styles.muted}>
            GPU contributions, earned PERL rewards and testnet migration.
          </p>
        </div>
        <div className={styles.stack}>
          <span
            className={`${styles.tag} ${status?.active ? styles.active : ""}`}
          >
            <i className={styles.dot} />
            {status?.active ? "Mainnet services" : "Mainnet preparation"}
          </span>
          {account ? (
            <button
              className={`${styles.btn} ${styles.secondary}`}
              onClick={() =>
                action(async () => {
                  await api("auth/logout", { method: "POST", body: "{}" });
                  setAccount(null);
                  setNewKey("");
                })
              }
            >
              {short(account.address)} · Sign out
            </button>
          ) : (
            <button className={styles.btn} disabled={busy} onClick={signIn}>
              <Wallet size={15} />
              Sign in with wallet
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className={`${styles.notice} ${styles.error}`}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className={styles.notice}>
          {notice}
        </div>
      )}
      <nav role="tablist" aria-label="Compute tools" className={styles.nav}>
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => changeTab(t)}
          >
            {t === "Convert" ? "Testnet migration" : t === "Mining" ? "Mining & rewards" : t}
          </button>
        ))}
      </nav>
      {tab === "Overview" && (
        <div className={styles.stack}>
          <div className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.label}>Available AI credits</span>
              <div className={styles.metric}>
                {account ? money(balance?.availableMicros) : "—"}
              </div>
              <span className={styles.label}>
                {account
                  ? money(balance?.heldMicros) + " reserved by requests"
                  : "Sign in to see your balance"}
              </span>
            </div>
            <div className={styles.card}>
              <span className={styles.label}>Earned mainnet round rewards</span>
              <div className={styles.metric}>
                {account ? perl(account.mining.earnedBaseUnits) : "—"}{" "}
                <small>PERL</small>
              </div>
              <span className={styles.label}>
                Earned allocations require a published, funded epoch.
              </span>
            </div>
            <div className={styles.card}>
              <span className={styles.label}>Model catalog</span>
              <div className={styles.metric}>
                {models.filter((m) => m.kind === "chat").length}
              </div>
              <span className={styles.label}>
                Priced model routes · {account?.mining.totalShares || 0}{" "}
                accepted shares
              </span>
            </div>
          </div>
          <div className={styles.two}>
            <div className={`${styles.card} ${styles.heroCard}`}>
              <span className={styles.eyebrow}>GPU → PERL → AI</span>
              <h2>
                Contribute compute.
                <br />
                Put it to work.
              </h2>
              <p>
                Qualifying mining rounds earn PERL allocations. Funded rewards
                can be claimed to your wallet, and PERL can purchase AI credits
                at the displayed quote.
              </p>
              <button
                className={styles.btn}
                onClick={() => changeTab("Mining")}
              >
                Explore mining <ArrowRight size={15} />
              </button>
            </div>
            <div className={styles.card}>
              <h2>Built around your wallet.</h2>
              <div className={styles.steps}>
                <div>
                  <strong>130M PERL · Mainnet mining allocation cap</strong>
                  <p className={styles.hint}>
                    A capped emission schedule with harder qualifying reward
                    rounds and a rolling contribution window.
                  </p>
                </div>
                <div>
                  <strong>70M PERL · Testnet migration maximum</strong>
                  <p className={styles.hint}>
                    100 eligible testnet PERL maps to 7 mainnet PERL. The global
                    claim limit is 1M PERL per UTC day.
                  </p>
                </div>
                <div>
                  <strong>Clear usage and spending controls</strong>
                  <p className={styles.hint}>
                    Each key has daily/monthly budgets. Failed and uncertain
                    requests remain visible in Billing.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {tab === "Models" && (
        <>
          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder="Search models or families"
              aria-label="Search models"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <span className={styles.hint}>
              {filtered.length} models · Prices in USD
            </span>
          </div>
          <div className={styles.grid}>
            {filtered.slice(page * 24, (page + 1) * 24).map((m) => (
              <article className={styles.card} key={m.id}>
                <span className={styles.eyebrow}>
                  {m.owned_by || "GPU network"}
                </span>
                <h2 className={styles.modelName}>{m.name}</h2>
                <div className={styles.mono}>{m.id}</div>
                {m.pricing ? (
                  <div className={styles.price}>
                    <span>
                      <b>${m.pricing.inputPerMillion.toFixed(6)}</b>Input / 1M
                      tokens
                    </span>
                    <span>
                      <b>${m.pricing.outputPerMillion.toFixed(6)}</b>Output / 1M
                      tokens
                    </span>
                  </div>
                ) : (
                  <p>{money(m.priceMicros || 0)} / replicated GPU job</p>
                )}
                <div className={styles.row}>
                  <span className={styles.label}>
                    {m.available ? "Configured" : "Not open"}
                  </span>
                  <button
                    className={`${styles.btn} ${styles.small}`}
                    onClick={() => {
                      if (m.kind === "chat") {
                        setSelected(m.id);
                        changeTab("Playground");
                      } else {
                        setJobModel(m.id);
                        changeTab("GPU jobs");
                      }
                    }}
                  >
                    Use model <ArrowUpRight size={12} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className={styles.empty}>
              The priced catalog will appear after the operator synchronizes
              model routes.
            </div>
          )}
          <div className={styles.toolbar} style={{ marginTop: 20 }}>
            <button
              className={`${styles.btn} ${styles.secondary}`}
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className={styles.hint}>Page {page + 1}</span>
            <button
              className={`${styles.btn} ${styles.secondary}`}
              disabled={(page + 1) * 24 >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {tab === "Playground" && (
        <div className={styles.card}>
          <div className={styles.notice}>
            <strong>
              {account
                ? `${account.trial?.remaining ?? 0} of 3 free chats remaining`
                : "Try 3 free chats"}
            </strong>
            <p className={styles.hint}>
              Sign in with your wallet. Free chats support short text prompts
              and up to 256 output tokens per reply. New conversations and page
              refreshes keep the same quota.
            </p>
            {account && (
              <label className={styles.field}>
                Payment mode
                <select
                  value={useFree ? "trial" : "credits"}
                  onChange={(e) => setUseFree(e.target.value === "trial")}
                >
                  <option
                    value="trial"
                    disabled={
                      !account.trial?.enabled || account.trial.remaining <= 0
                    }
                  >
                    Use free chat
                  </option>
                  <option value="credits">Use credits</option>
                </select>
              </label>
            )}
            <button
              className={`${styles.btn} ${styles.secondary}`}
              onClick={() => changeTab("Convert")}
            >
              Add credits with USDG
            </button>
          </div>
          <div className={styles.row}>
            <label className={styles.field}>
              Model
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {models
                  .filter((m) => m.kind === "chat")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className={`${styles.btn} ${styles.secondary}`}
              disabled={sending}
              onClick={() => setMessages([])}
            >
              New conversation
            </button>
          </div>
          <div className={styles.chat}>
            {messages.length ? (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`${styles.message} ${m.role === "user" ? styles.user : ""}`}
                >
                  <span className={styles.eyebrow}>
                    {m.role === "user"
                      ? "You"
                      : models.find((m) => m.id === selected)?.name ||
                        "Assistant"}
                  </span>
                  <div>{m.content || "Thinking…"}</div>
                </div>
              ))
            ) : (
              <div className={styles.empty}>
                Choose a model and send a prompt.
                <br />
                Requests use your account credits and appear in Billing.
              </div>
            )}
          </div>
          <label className={styles.field}>
            Your prompt
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask a question, draft something, or work through an idea."
            />
          </label>
          <div className={styles.row} style={{ marginTop: 14 }}>
            <span className={styles.hint}>
              Conversation is kept in this browser session. Results are
              encrypted for 24-hour idempotent retries.
            </span>
            {sending ? (
              <button
                className={styles.btn}
                onClick={() => stop.current?.abort()}
              >
                <Square size={13} />
                Stop
              </button>
            ) : (
              <button
                className={styles.btn}
                disabled={
                  !account ||
                  !status?.active ||
                  !status.features.api ||
                  !prompt.trim() ||
                  !selected ||
                  (useFree &&
                    (!account?.trial?.enabled || account.trial.remaining <= 0))
                }
                onClick={() => void send()}
              >
                <Play size={13} />
                {useFree ? "Send free chat" : "Send using credits"}
              </button>
            )}
          </div>
        </div>
      )}
      {tab === "Developer" && (
        <div className={styles.two}>
          <section className={styles.card}>
            <h2>API keys</h2>
            <p className={styles.hint}>
              Keys are shown once. Store them on your server; never expose them
              in a public frontend.
            </p>
            {newKey && (
              <div className={styles.key}>
                <strong>{newKey}</strong>
                <div className={styles.row} style={{ marginTop: 10 }}>
                  <CopyText value={newKey} />
                  <button
                    className={`${styles.btn} ${styles.small} ${styles.secondary}`}
                    onClick={() => setNewKey("")}
                  >
                    I saved this key
                  </button>
                </div>
              </div>
            )}
            <div className={styles.form}>
              <label className={styles.field}>
                Key name
                <input
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  maxLength={64}
                />
              </label>
              <div className={styles.two}>
                <label className={styles.field}>
                  Daily limit · USD
                  <input
                    type="number"
                    min="0.001"
                    step="0.01"
                    value={daily}
                    onChange={(e) => setDaily(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  Monthly limit · USD
                  <input
                    type="number"
                    min="0.001"
                    step="0.01"
                    value={monthly}
                    onChange={(e) => setMonthly(e.target.value)}
                  />
                </label>
              </div>
              <label className={styles.field}>
                Allowed models
                <input
                  value={keyModels}
                  onChange={(e) => setKeyModels(e.target.value)}
                  placeholder="* or comma-separated model IDs"
                />
              </label>
              <div className={styles.two}>
                <label className={styles.field}>
                  Permissions
                  <select
                    value={keyScope}
                    onChange={(e) => setKeyScope(e.target.value)}
                  >
                    <option value="chat,jobs">Chat and GPU jobs</option>
                    <option value="chat">Chat only</option>
                    <option value="jobs">GPU jobs only</option>
                  </select>
                </label>
                <label className={styles.field}>
                  Requests per minute
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={keyRpm}
                    onChange={(e) => setKeyRpm(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  Concurrent requests
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={keyConcurrency}
                    onChange={(e) => setKeyConcurrency(e.target.value)}
                  />
                </label>
              </div>
              <button
                className={styles.btn}
                disabled={!account || busy}
                onClick={createApiKey}
              >
                <KeyRound size={14} />
                Create API key
              </button>
            </div>
            <div className={styles.steps}>
              {account?.keys
                .filter((k: Data) => !k.revoked)
                .map((k: Data) => (
                  <div key={k.id} className={styles.row}>
                    <div>
                      <strong>{k.name}</strong>
                      <div className={styles.mono}>{k.prefix}…</div>
                      <span className={styles.hint}>
                        {money(k.daily_limit)} / day · {k.rpm} requests/min
                      </span>
                    </div>
                    <button
                      className={`${styles.btn} ${styles.secondary} ${styles.small}`}
                      onClick={() =>
                        action(async () => {
                          await api("keys/" + k.id, { method: "DELETE" });
                          await refresh();
                        })
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
            </div>
          </section>
          <section className={styles.card}>
            <h2>One endpoint. Your models.</h2>
            <p className={styles.hint}>
              OpenAI-compatible chat completions and Anthropic-compatible
              messages. Use a fresh Idempotency-Key for each intended request;
              reuse it only when retrying the same request.
            </p>
            <pre
              className={styles.code}
            >{`curl '${typeof window === "undefined" ? "https://perlacompute.xyz" : window.location.origin}/v1/chat/completions' \\\n  -H 'Authorization: Bearer YOUR_PERLA_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: unique-request-001' \\\n  -d '{"model":"${selected || "MODEL_ID"}","messages":[{"role":"user","content":"Hello"}],"max_tokens":1024,"stream":true}'`}</pre>
            <p className={styles.hint}>
              Anthropic clients use the site root as base URL and call{" "}
              <code>/v1/messages</code>. Model IDs come from{" "}
              <code>/v1/models</code>.
            </p>
            <p className={styles.hint}>
              429 means the request or capacity limit was reached. 402 means
              credits or a key budget are insufficient. A billing-review
              response keeps one reservation until the upstream outcome is
              reconciled.
            </p>
          </section>
        </div>
      )}
      {tab === "Billing" && (
        <div className={styles.stack}>
          <div className={styles.grid}>
            {[
              ["Available", balance?.availableMicros],
              ["Reserved", balance?.heldMicros],
              ["Total usage", balance?.totals.charged],
            ].map(([label, n]) => (
              <div className={styles.card} key={label}>
                <span className={styles.label}>{label}</span>
                <div className={styles.metric}>
                  {account ? money(Number(n)) : "—"}
                </div>
              </div>
            ))}
          </div>
          <section className={styles.card}>
            <div className={styles.row}>
              <h2>Request history</h2>
              <button
                className={`${styles.btn} ${styles.secondary}`}
                onClick={() => void action(refresh)}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            <p className={styles.hint}>
              A reservation is a spending ceiling. Unused credits are released
              when usage settles. “Unknown” requests retain their hold for
              billing reconciliation.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Request / model</th>
                    <th>State</th>
                    <th>Input / output</th>
                    <th>Charge</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {balance?.requests.map((r: Data) => (
                    <tr key={r.id}>
                      <td>
                        {r.model}
                        <div className={styles.mono}>{short(r.id)}</div>
                      </td>
                      <td>
                        {r.state === "unknown" ? "Billing review" : r.state}
                      </td>
                      <td>
                        {r.input_tokens} / {r.output_tokens}
                      </td>
                      <td>
                        {r.billing_source === "trial"
                          ? "Free chat"
                          : r.state === "completed"
                            ? money(r.charged)
                            : r.state === "failed"
                              ? "No charge"
                              : money(r.reserved) + " held"}
                      </td>
                      <td>{when(r.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!balance?.requests.length && (
              <div className={styles.empty}>
                Your model and GPU-job usage will appear here.
              </div>
            )}
          </section>
        </div>
      )}
      {tab === "Convert" && (
        <div className={styles.two}>
          <section className={styles.card}>
            <span className={styles.eyebrow}>TESTNET → MAINNET</span>
            <h2>Reward migration.</h2>
            <p className={styles.hint}>
              100 eligible testnet PERL → 7 mainnet PERL. Eligibility comes from
              the funded earned-reward snapshot, not arbitrary token balances.
            </p>
            <div className={styles.metric}>
              {migration?.amount ? perl(migration.amount) : "—"}{" "}
              <small>PERL</small>
            </div>
            <p className={styles.hint}>
              70M maximum migration reserve. The shared claim limit is 1M
              mainnet PERL per UTC day.
            </p>
            {migration?.cutoff != null && <p className={styles.hint}>Snapshot: earned testnet rewards through UTC epoch {migration.cutoff}.</p>}
            {migration?.amount && (!migration.available || !migration.funded) && <p className={styles.notice}>The snapshot is recorded. Claims open after its full entitlement is backed and published.</p>}
            {migration?.remainingBaseUnits && (
              <div className={styles.form}>
                <span className={styles.hint}>
                  Your remaining allocation:{" "}
                  {perl(migration.remainingBaseUnits)} PERL.
                  <br />
                  Global daily capacity:{" "}
                  {perl(migration.dailyRemainingBaseUnits)} PERL.
                </span>
                <label className={styles.field}>
                  Amount to claim
                  <input
                    value={migrateAmount}
                    onChange={(e) => setMigrateAmount(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <button
                  className={styles.btn}
                  disabled={busy || !migration.available || !migration.funded}
                  onClick={claimMigration}
                >
                  Claim migration allocation
                </button>
              </div>
            )}
            {!migration?.amount && (
              <div className={styles.notice}>
                {migration?.reason ||
                  "Migration opens after the snapshot and mainnet reserve are published."}
              </div>
            )}
          </section>
        </div>
      )}
      {tab === "Mining" && (
        <div className={styles.stack}>
          <section className={styles.card}>
            <span className={styles.eyebrow}>MAINNET REWARD POLICY</span>
            <h2>
              {status?.normalRoundPoolBaseUnits
                ? `~${perl(status.normalRoundPoolBaseUnits)} PERL`
                : "—"}{" "}
              per qualifying round.
            </h2>
            <p className={styles.hint}>
              A shared PPLNS pool, allocated by contribution in the rolling
              window. The 130M PERL allocation cap spans 1,460 days, with 4–5 possible
              qualifying rounds per day. Winning proofs determine payouts; this
              is not a guaranteed reward per worker or a fixed daily return.
            </p>
          </section>
          <div className={styles.two}>
            <section className={styles.card}>
              <h2>Connect a mainnet worker.</h2>
              <p className={styles.hint}>
                Your machine keeps its permanent Worker ID. The mainnet
                companion uses a separate saved connection and reuses the
                verified CUDA build.
              </p>
              <div className={styles.form}>
                <label className={styles.field}>
                  Worker name
                  <input
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    maxLength={48}
                  />
                </label>
                <label className={styles.field}>
                  GPU device index
                  <select
                    value={device}
                    onChange={(e) => setDevice(e.target.value)}
                  >
                    {Array.from({ length: 8 }, (_, i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                  <span className={styles.hint}>
                    0 selects the first visible GPU. Keep 0 on a machine with
                    one GPU.
                  </span>
                </label>
              </div>
              {command ? (
                <>
                  <pre className={styles.code}>{command}</pre>
                  <CopyText value={command} label="Copy install & start" />
                </>
              ) : (
                <div className={styles.notice} style={{ marginTop: 16 }}>
                  Installation commands appear after the mainnet release and
                  checksums are publicly verified.
                </div>
              )}
              <p className={styles.footnote}>
                RTX 30 / 40 / 50 hosts. Run on your GPU machine. Mining is
                continuous; Ctrl+C stops the foreground worker.
              </p>
            </section>
            <section className={styles.card}>
              <h2>Use an existing worker.</h2>
              <p className={styles.hint}>
                On the new GPU host, run{" "}
                <code>perla-mainnet reconnect --worker-id YOUR_ID</code>. Enter
                the request and confirmation code printed there. Your wallet
                signature authorizes replacement of the old machine credential.
              </p>
              <div className={styles.form}>
                <label className={styles.field}>
                  Reconnect request
                  <input
                    value={reconnect}
                    onChange={(e) => setReconnect(e.target.value)}
                    placeholder="Request ID from GPU terminal"
                  />
                </label>
                <label className={styles.field}>
                  GPU confirmation code
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="12-character confirmation code"
                    maxLength={12}
                  />
                </label>
                <button
                  className={styles.btn}
                  disabled={
                    !account || busy || !reconnect || code.length !== 12
                  }
                  onClick={() =>
                    action(async () => {
                      await api("reconnect/approve", {
                        method: "POST",
                        body: JSON.stringify({ id: reconnect, code }),
                      });
                      setNotice(
                        "Approved. Keep the new GPU terminal running to finish the credential exchange.",
                      );
                    })
                  }
                >
                  Approve new machine
                </button>
              </div>
            </section>
          </div>
          <section className={styles.card}>
            <h2>Your workers</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Permanent ID</th>
                    <th>GPU / state</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {account?.mining.workers.map((w: Data) => (
                    <tr key={w.id}>
                      <td>{w.name}</td>
                      <td>
                        <div className={styles.mono}>{w.id}</div>
                        <CopyText value={w.id} />
                      </td>
                      <td>
                        {w.gpu || "GPU check pending"}
                        <div className={styles.hint}>
                          {w.revoked
                            ? "Revoked"
                            : w.online
                              ? "Online"
                              : "Offline"}
                        </div>
                      </td>
                      <td>
                        {!w.revoked && (
                          <button
                            className={`${styles.btn} ${styles.small} ${styles.secondary}`}
                            onClick={() =>
                              action(async () => {
                                await api("workers/" + w.id, {
                                  method: "DELETE",
                                });
                                await refresh();
                              })
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!account?.mining.workers.length && (
              <div className={styles.empty}>
                The first successful connection creates your permanent Worker
                ID.
              </div>
            )}
          </section>
          <section className={styles.card}>
            <h2>Earned epoch allocations</h2>
            <p className={styles.hint}>
              Accepted shares contribute to the rolling window. PERL is
              allocated when a proof wins the harder round target. Receiving a
              task or an ordinary share does not create a token reward.
            </p>
            {allocations.map((a) => (
              <div className={styles.steps} key={a.epoch}>
                <div className={styles.row}>
                  <div>
                    <strong>
                      Epoch {a.epoch} · {perl(a.amount)} PERL
                    </strong>
                    <div className={styles.hint}>
                      {a.unavailable
                        ? "Chain check unavailable"
                        : a.claimed
                          ? "Claimed"
                          : a.funded
                            ? "Funded"
                            : "Awaiting publication / funding"}
                    </div>
                  </div>
                  <button
                    className={styles.btn}
                    disabled={busy || !a.funded || a.claimed}
                    onClick={() => claimMining(a)}
                  >
                    Claim
                  </button>
                </div>
              </div>
            ))}
            {!allocations.length && (
              <div className={styles.empty}>
                Your published earned allocations appear here after epoch close.
              </div>
            )}
          </section>
        </div>
      )}
      {tab === "GPU jobs" && (
        <div className={styles.two}>
          <section className={styles.card}>
            <h2>Run a GPU inference job.</h2>
            <p className={styles.hint}>
              Open-model jobs are executed by approved GPU workers. Two matching
              results from separate worker wallets are required before the job
              settles.
            </p>
            <div className={styles.form}>
              <label className={styles.field}>
                Pinned GPU model
                <select
                  value={jobModel}
                  onChange={(e) => setJobModel(e.target.value)}
                >
                  {models
                    .filter((m) => m.kind === "gpu-job")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {money(m.priceMicros || 0)} / job
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                Prompt
                <textarea
                  value={jobPrompt}
                  onChange={(e) => setJobPrompt(e.target.value)}
                />
              </label>
              <span className={styles.hint}>
                {models.find((m) => m.id === jobModel)?.independentWallets || 0}{" "}
                approved worker wallets online. Price is fixed per replicated
                job.
              </span>
              <button
                className={styles.btn}
                disabled={
                  !account ||
                  busy ||
                  !status?.features.gpu ||
                  !models.find((m) => m.id === jobModel)?.available ||
                  !jobPrompt.trim()
                }
                onClick={() =>
                  action(async () => {
                    const created = await api("jobs", {
                      method: "POST",
                      headers: { "idempotency-key": crypto.randomUUID() },
                      body: JSON.stringify({
                        model: jobModel,
                        messages: [{ role: "user", content: jobPrompt }],
                        max_tokens: 128,
                      }),
                    });
                    setJob(await api("jobs/" + created.id));
                    await refresh();
                  })
                }
              >
                Submit GPU job
              </button>
            </div>
          </section>
          <section className={styles.card}>
            <h2>Job result</h2>
            {job ? (
              <>
                <span className={styles.tag}>{job.state}</span>
                <p className={styles.mono}>{job.id}</p>
                <div className={styles.result}>
                  {job.result?.text ||
                    (["queued", "running"].includes(job.state)
                      ? "Waiting for independently matching worker results."
                      : "The job did not reach agreement; inspect Billing for its released reservation.")}
                </div>
              </>
            ) : (
              <div className={styles.empty}>No job selected.</div>
            )}
            <p className={styles.footnote}>
              Replicated agreement checks matching deterministic outputs. It
              does not prove semantic correctness. Matrix mining and GPU
              inference are distinct workloads.
            </p>
          </section>
        </div>
      )}
      {tab === "Explorer" && (
        <div className={styles.stack}>
          <section className={styles.card}>
            <div className={styles.row}>
              <h2>Mainnet proof explorer</h2>
              <button
                className={`${styles.btn} ${styles.secondary}`}
                onClick={() =>
                  action(async () => setExplorer(await api("public/explorer")))
                }
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            <p className={styles.hint}>
              Accepted native matrix work, qualifying rounds and published
              payout roots.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Recipient</th>
                    <th>Epoch</th>
                    <th>Result</th>
                    <th>Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {explorer?.receipts.map((r: Data) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className={`${styles.btn} ${styles.secondary} ${styles.small}`}
                          onClick={() =>
                            action(async () =>
                              setReceipt(await api("public/receipt/" + r.id)),
                            )
                          }
                        >
                          {short(r.id)}
                        </button>
                      </td>
                      <td className={styles.mono}>{short(r.address)}</td>
                      <td>{r.epoch}</td>
                      <td>
                        {r.round_won
                          ? "Qualifying round winner"
                          : "Accepted share"}
                      </td>
                      <td>{when(r.accepted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!explorer?.receipts.length && (
              <div className={styles.empty}>
                Mainnet receipts appear after accepted work.
              </div>
            )}
          </section>
          {receipt && (
            <section className={styles.card}>
              <h2>Receipt details</h2>
              <pre className={styles.code}>
                {JSON.stringify(receipt, null, 2)}
              </pre>
              <a
                className={styles.link}
                href={"/api/compute/public/proof/" + receipt.id}
                target="_blank"
                rel="noreferrer"
              >
                Read native proof payload
              </a>
            </section>
          )}
          <section className={styles.card}>
            <h2>Published reward epochs</h2>
            {explorer?.epochs.map((e: Data) => (
              <div className={styles.steps} key={e.epoch}>
                <div className={styles.row}>
                  <span>
                    Epoch {e.epoch} · {perl(e.budget)} PERL · {e.state}
                  </span>
                  {e.tx_hash && (
                    <a
                      className={styles.link}
                      href={
                        "https://robinhoodchain.blockscout.com/tx/" + e.tx_hash
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Funding proof <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
      <p className={styles.footnote}>
        Robinhood Chain · 4663. Mining and migration
        open only after their contract and reserve checks pass. Testnet history
        is retained separately.
      </p>
    </div>
  );
}
