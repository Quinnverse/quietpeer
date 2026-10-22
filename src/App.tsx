import {
  ArrowUpRight,
  Check,
  Copy,
  Fingerprint,
  Info,
  Link2,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ChatClient } from "./core/client";
import type { Message, Snapshot } from "./core/types";
import "./styles.css";

const connectionLabels: Record<Snapshot["connection"], string> = {
  idle: "准备开始",
  creating: "正在创建房间",
  waiting: "等待对方加入",
  connecting: "正在建立加密通道",
  connected: "已连接",
  interrupted: "连接中断",
  failed: "连接失败",
  closed: "会话已结束",
};

const verificationLabels: Record<Snapshot["verification"], string> = {
  unverified: "身份尚未核对",
  "local-confirmed": "已由你确认，等待对方",
  verified: "身份已验证 · 本次端点",
  mismatch: "指纹验证失败",
  revoked: "身份已撤销",
};

const messageStateLabels: Record<Message["state"], string> = {
  buffered: "发送中",
  delivered: "已送达",
  unknown: "送达未知",
  failed: "未送达",
};

function compactFingerprint(value: string): string {
  return value.replace(/^sha-?256\s*[:=]?\s*/i, "").replace(/[^a-f0-9]/gi, "").toLowerCase();
}

function formatTime(time: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function isTerminal(connection: Snapshot["connection"]): boolean {
  return connection === "failed" || connection === "closed";
}

function ConnectionMark({ connection }: { connection: Snapshot["connection"] }) {
  const unstable = connection === "failed" || connection === "interrupted" || connection === "closed";
  return <span className={`connection-mark${unstable ? " is-alert" : ""}`} aria-hidden="true" />;
}

export default function App() {
  const client = useMemo(() => new ChatClient(), []);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [inviteInput, setInviteInput] = useState("");
  const [peerFingerprintInput, setPeerFingerprintInput] = useState("");
  const [draft, setDraft] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fragmentInvite = query.get("invite");

    if (fragmentInvite) {
      setInviteInput(fragmentInvite);
      // An invite is a one-time handoff, not application state or a join side effect.
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  const canCompose =
    snapshot.connection === "connected" &&
    snapshot.verification === "verified" &&
    snapshot.bindingReady;
  const pastedFingerprintMatches =
    Boolean(peerFingerprintInput.trim()) &&
    Boolean(snapshot.remoteFingerprint) &&
    compactFingerprint(peerFingerprintInput) === compactFingerprint(snapshot.remoteFingerprint);
  const canConfirm =
    pastedFingerprintMatches &&
    Boolean(snapshot.localFingerprint) &&
    snapshot.bindingReady &&
    snapshot.connection === "connected" &&
    snapshot.verification !== "verified" &&
    snapshot.verification !== "mismatch" &&
    snapshot.verification !== "revoked";
  const hasActiveSession =
    snapshot.connection !== "idle" && !isTerminal(snapshot.connection);
  const canStart = !hasActiveSession;

  const createRoom = async () => {
    setCopyNotice("");
    await client.create();
  };

  const joinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invite = inviteInput.trim();
    if (!invite) return;
    setCopyNotice("");
    await client.join(invite);
  };

  const copyInvite = async () => {
    if (!snapshot.invite) return;
    setCopyNotice("");
    try {
      await navigator.clipboard.writeText(snapshot.invite);
      setCopyNotice("邀请已复制，可通过可信渠道发送给对方。");
    } catch {
      setCopyNotice("无法自动复制。请手动选择并复制邀请信息。");
    }
  };

  const confirmIdentity = async () => {
    if (!canConfirm) return;
    await client.confirm(peerFingerprintInput.trim());
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !canCompose) return;
    setDraft("");
    await client.sendText(body);
  };

  const startNewSession = () => {
    setDraft("");
    setPeerFingerprintInput("");
    setInviteInput("");
    setCopyNotice("");
    client.reset();
  };

  const helperText = (() => {
    if (snapshot.verification === "verified") {
      return "双方已确认核对。仅在你确实使用了独立可信渠道时，才可信任这个端点。";
    }
    if (snapshot.verification === "local-confirmed" || snapshot.localConfirmed) {
      return "你已确认。为保护会话，仍需等待对方独立确认后才会开放聊天。";
    }
    if (snapshot.verification === "mismatch" || snapshot.verification === "revoked") {
      return "身份核验未通过。不要继续发送信息；请结束会话并通过可信渠道重新确认。";
    }
    if (!snapshot.localFingerprint || !snapshot.remoteFingerprint) {
      return "正在等待可核验的端点指纹。加密建立不等于身份已核对。";
    }
    if (peerFingerprintInput.trim() && !pastedFingerprintMatches) {
      return "粘入的指纹与此连接的对端指纹不一致。请勿确认。";
    }
    return "把对方通过独立可信渠道告知的完整指纹粘入此处，匹配后才能确认。";
  })();

  return (
    <main className="quietpeer-shell">
      <aside className="rail" aria-label="会话导航">
        <div className="brand-lockup">
          <div className="brand-icon" aria-hidden="true">
            <Link2 size={20} strokeWidth={2.25} />
          </div>
          <div>
            <p className="eyebrow">QUIETPEER</p>
            <h1>只在你们之间。</h1>
          </div>
        </div>

        <div className="rail-rule" />

        {canStart ? (
          <section className="start-panel" aria-labelledby="start-title">
            <p className="section-kicker">会话</p>
            <h2 id="start-title">开始一段私密对话</h2>
            <p>创建新房间，或使用对方提供的邀请信息加入。不会自动加入链接中的房间。</p>
            <button className="button button-primary button-wide" type="button" onClick={createRoom}>
              <Plus size={17} aria-hidden="true" />
              创建房间
            </button>
            <div className="or-divider"><span>或</span></div>
            <form className="join-form" onSubmit={joinRoom}>
              <label htmlFor="invite-entry">邀请信息</label>
              <textarea
                id="invite-entry"
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                placeholder="粘贴 room.token 或完整邀请链接"
                rows={3}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="button button-secondary button-wide" type="submit" disabled={!inviteInput.trim()}>
                <ArrowUpRight size={17} aria-hidden="true" />
                加入房间
              </button>
            </form>
          </section>
        ) : (
          <section className="session-card" aria-labelledby="session-title">
            <div className="session-title-row">
              <p className="section-kicker" id="session-title">当前会话</p>
              <ConnectionMark connection={snapshot.connection} />
            </div>
            <p className="session-room">{snapshot.roomId || "正在准备房间"}</p>
            <p className="session-caption">此会话只保存在当前浏览器内存中。</p>
          </section>
        )}

        <section className="invite-panel" aria-labelledby="invite-title">
          <div className="label-row">
            <label id="invite-title" htmlFor="invite-link">邀请信息</label>
            {snapshot.role === "a" && <span className="role-chip">创建者</span>}
          </div>
          <input
            id="invite-link"
            data-testid="invite-link"
            className="invite-value mono"
            aria-label="房间邀请链接"
            value={snapshot.invite}
            readOnly
          />
          <button
            className="text-action"
            type="button"
            onClick={copyInvite}
            disabled={!snapshot.invite}
          >
            <Copy size={15} aria-hidden="true" />
            复制邀请
          </button>
          {copyNotice && <p className="inline-notice" role="status">{copyNotice}</p>}
          <p className="fine-print">邀请链接仅用于建立连接；请只通过你信任的方式交给对方。</p>
        </section>

        <div className="rail-bottom">
          <button className="privacy-link" type="button" onClick={() => setPrivacyOpen(true)}>
            <Info size={16} aria-hidden="true" />
            隐私与边界
          </button>
        </div>
      </aside>

      <section className="conversation" aria-labelledby="conversation-title">
        <header className="conversation-header">
          <div>
            <p className="eyebrow">一对一私密会话</p>
            <h2 id="conversation-title">直接交流，先核验身份</h2>
          </div>
          <div className="connection-summary" data-testid="connection-state" data-state={snapshot.connection}>
            <ConnectionMark connection={snapshot.connection} />
            <span>{connectionLabels[snapshot.connection]}</span>
          </div>
        </header>

        {(snapshot.error || snapshot.notice || isTerminal(snapshot.connection)) && (
          <div className={`status-banner${snapshot.error || snapshot.connection === "failed" ? " danger" : ""}`} role="alert">
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>{snapshot.error || (snapshot.connection === "closed" ? "会话已经结束" : "会话状态发生变化")}</strong>
              <p>
                {snapshot.connection === "closed"
                  ? "结束会话不会保留消息。创建新会话后，请重新核验身份。"
                  : snapshot.notice || "为保护本次会话，请检查右侧安全核对信息。"}
              </p>
            </div>
            {isTerminal(snapshot.connection) && (
              <button className="button button-compact" type="button" onClick={startNewSession}>
                <RotateCcw size={15} aria-hidden="true" />
                新建会话
              </button>
            )}
          </div>
        )}

        <div className="conversation-context">
          {canCompose ? (
            <>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>身份已核对。消息经 DTLS 加密传输。</span>
            </>
          ) : (
            <>
              <LockKeyhole size={17} aria-hidden="true" />
              <span>通道可以已加密，但双方身份核对完成前不会发送正文。</span>
            </>
          )}
        </div>

        <div className="message-scroller" data-testid="message-list" aria-live="polite" aria-label="消息列表">
          {snapshot.messages.length === 0 ? (
            <div className="empty-conversation">
              <MessageCircle size={28} strokeWidth={1.5} aria-hidden="true" />
              <p>消息只显示在当前会话中。</p>
              <span>刷新页面或结束会话后，历史不会保留。</span>
            </div>
          ) : (
            snapshot.messages.map((message) => (
              <article
                className={`message message-${message.direction}`}
                data-testid={`message-${message.id}`}
                key={message.id}
              >
                <p>{message.body}</p>
                <footer>
                  <time dateTime={new Date(message.time).toISOString()}>{formatTime(message.time)}</time>
                  {message.direction === "out" && (
                    <span className={`delivery delivery-${message.state}`}>
                      {messageStateLabels[message.state]}
                    </span>
                  )}
                </footer>
              </article>
            ))
          )}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <label className="sr-only" htmlFor="message-input">消息内容</label>
          <textarea
            id="message-input"
            data-testid="message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={canCompose ? "写下消息…" : "请先完成双方身份核对"}
            disabled={!canCompose}
            maxLength={4096}
            rows={2}
          />
          <div className="composer-footer">
            <span>{canCompose ? "送达仅表示对方设备收到，不表示已读。" : "双方确认前，输入保持关闭。"}</span>
            <button
              className="button button-primary send-button"
              data-testid="send-button"
              type="submit"
              disabled={!canCompose || !draft.trim()}
            >
              <Send size={17} aria-hidden="true" />
              发送
            </button>
          </div>
        </form>
      </section>

      <aside className="security-panel" aria-labelledby="security-title">
        <div className="security-heading">
          <div className="security-icon" aria-hidden="true"><Fingerprint size={21} /></div>
          <div>
            <p className="eyebrow">安全核对</p>
            <h2 id="security-title">核对端点身份</h2>
          </div>
        </div>

        <div className={`verification-state verification-${snapshot.verification}`} data-testid="verification-state" data-state={snapshot.verification}>
          {snapshot.verification === "verified" ? <ShieldCheck size={18} aria-hidden="true" /> : <ShieldQuestion size={18} aria-hidden="true" />}
          <span>{verificationLabels[snapshot.verification]}</span>
        </div>

        <div className="identity-copy">
          <p>DTLS 已加密<strong>不等于</strong>身份已核对。请通过电话、当面或另一条可信渠道比对以下完整指纹。</p>
        </div>

        <section className="fingerprint-block" aria-labelledby="local-fingerprint-label">
          <div className="fingerprint-label-row">
            <label id="local-fingerprint-label" htmlFor="local-fingerprint">你的完整指纹</label>
            <span>步骤 1</span>
          </div>
          <textarea
            id="local-fingerprint"
            data-testid="local-fingerprint"
            className="fingerprint mono"
            rows={4}
            value={snapshot.localFingerprint}
            readOnly
            aria-label="你的完整指纹"
          />
          <p>将这串完整指纹通过独立可信渠道发给对方。</p>
        </section>

        <section className="fingerprint-block" aria-labelledby="remote-fingerprint-label">
          <div className="fingerprint-label-row">
            <label id="remote-fingerprint-label" htmlFor="remote-fingerprint">此连接的对端指纹</label>
            <span>步骤 2</span>
          </div>
          <textarea
            id="remote-fingerprint"
            data-testid="remote-fingerprint"
            className="fingerprint mono"
            rows={4}
            value={snapshot.remoteFingerprint}
            readOnly
            aria-label="此连接的对端指纹"
          />
          <p>这是本次连接实际取得的指纹，不是对方声称的身份。</p>
        </section>

        <section className="confirmation-form" aria-labelledby="confirmation-title">
          <div className="fingerprint-label-row">
            <label id="confirmation-title" htmlFor="peer-fingerprint-entry">对方带外指纹</label>
            <span>步骤 3</span>
          </div>
          <textarea
            id="peer-fingerprint-entry"
            value={peerFingerprintInput}
            onChange={(event) => setPeerFingerprintInput(event.target.value)}
            placeholder="粘贴对方通过可信渠道告知的完整 SHA-256 指纹"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            disabled={!snapshot.remoteFingerprint || snapshot.verification === "verified"}
          />
          <p className={`confirmation-helper${pastedFingerprintMatches ? " matches" : ""}`}>{helperText}</p>
          <div className="verification-actions">
            <button className="button button-primary" type="button" onClick={confirmIdentity} disabled={!canConfirm}>
              <Check size={17} aria-hidden="true" />
              确认指纹一致
            </button>
            <button
              className="button button-danger-quiet"
              type="button"
              onClick={() => client.rejectIdentity()}
              disabled={!snapshot.remoteFingerprint || snapshot.verification === "verified"}
            >
              <X size={17} aria-hidden="true" />
              指纹不一致
            </button>
          </div>
        </section>

        <div className="transport-note">
          <LockKeyhole size={17} aria-hidden="true" />
          <p>此工具不提供匿名性，也无法隐藏网络地址。会话、指纹和消息只保存在内存；刷新页面会丢失历史。</p>
        </div>

        <div className="end-session">
          <button className="text-action danger-action" type="button" onClick={() => client.end()} disabled={snapshot.connection === "idle" || isTerminal(snapshot.connection)}>
            <LogOut size={16} aria-hidden="true" />
            结束会话
          </button>
          <p>结束将断开连接并清除本页消息，不会保留过往内容。</p>
        </div>
      </aside>

      {privacyOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPrivacyOpen(false)}>
          <section
            className="privacy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">隐私与边界</p>
                <h2 id="privacy-title">请了解这次会话的范围</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setPrivacyOpen(false)} aria-label="关闭隐私说明">
                <X size={19} aria-hidden="true" />
              </button>
            </div>
            <div className="modal-copy">
              <p>QuietPeer 使用浏览器之间的加密传输，并要求双方通过独立可信渠道核对本次会话的端点指纹。</p>
              <p>这不是匿名工具：网络连接可能向参与方及其网络服务提供者暴露地址等网络层信息。请自行判断是否适合传递敏感内容。</p>
              <p>消息、邀请和核验材料不会在此界面持久保存；刷新、离开或结束会话都会使当前历史不可恢复。</p>
              <p>“已送达”仅表示收到了有效确认，不代表对方已阅读或理解内容。</p>
            </div>
            <button className="button button-primary" type="button" onClick={() => setPrivacyOpen(false)}>我已了解</button>
          </section>
        </div>
      )}
    </main>
  );
}
