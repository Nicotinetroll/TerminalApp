export function EmptyState() {
  return (
    <div className="whisper-empty">
      <div className="whisper-empty-icon">{'>'}_</div>
      <div className="whisper-empty-text">
        select a ghost to haunt...
        <br />
        or wait for someone to haunt you
      </div>
      <div className="whisper-empty-sub">
        messages self-destruct after 24h. no receipts.
      </div>
    </div>
  );
}
