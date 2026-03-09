interface Props {
  addresses: { full: string }[];
  onClose: () => void;
}

export function SetupGuide({ addresses, onClose }: Props) {
  const addr = addresses[0]?.full ?? "you@mynig.ga";

  return (
    <div className="mail-setup-guide">
      <div className="mail-signature-header">
        <h3>mail setup</h3>
        <button className="btn" onClick={onClose}>close</button>
      </div>

      <div className="mail-setup-content">
        <div className="mail-setup-section">
          <div className="mail-setup-section-title">your address</div>
          <div className="mail-setup-addr">{addr}</div>
        </div>

        <div className="mail-setup-section">
          <div className="mail-setup-section-title">add to gmail / email app</div>
          <p className="mail-setup-text">
            IMAP access is not available yet. for now, use the web terminal to read and send mail.
          </p>
          <p className="mail-setup-text">
            incoming mail works — anyone can send you an email at your @mynig.ga address
            and it lands right here in the terminal.
          </p>
        </div>

        <div className="mail-setup-section">
          <div className="mail-setup-section-title">connection settings</div>
          <table className="mail-setup-table">
            <tbody>
              <tr><td>incoming (IMAP)</td><td className="mail-setup-val-na">coming soon</td></tr>
              <tr><td>outgoing (SMTP)</td><td>mail.mynig.ga : 25</td></tr>
              <tr><td>domain</td><td>mynig.ga</td></tr>
              <tr><td>encryption</td><td>STARTTLS</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mail-setup-section">
          <div className="mail-setup-section-title">gmail "send as" setup</div>
          <p className="mail-setup-text">
            once IMAP is available, you'll be able to read your mynig.ga mail directly in gmail.
            for now, you can set up gmail to <strong>send</strong> from your @mynig.ga address:
          </p>
          <ol className="mail-setup-steps">
            <li>gmail settings &gt; accounts &gt; send mail as &gt; add another email</li>
            <li>enter your name and <strong>{addr}</strong></li>
            <li>SMTP server: <strong>mail.mynig.ga</strong>, port <strong>25</strong></li>
            <li>no authentication needed for now</li>
          </ol>
          <p className="mail-setup-hint">
            note: some ISPs block port 25. if it doesn't work, use the terminal to send mail instead.
          </p>
        </div>

        <div className="mail-setup-section">
          <div className="mail-setup-section-title">what works right now</div>
          <ul className="mail-setup-list">
            <li>receive email from anywhere (gmail, outlook, etc.)</li>
            <li>send to other @mynig.ga users (instant)</li>
            <li>send to external addresses (direct SMTP)</li>
            <li>attachments up to 5MB</li>
            <li>custom signatures per address</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
