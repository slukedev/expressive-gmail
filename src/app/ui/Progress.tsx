/** The wave is a CSS mask scrolled on the compositor, so it costs nothing on the main thread. */
export function LinearProgress({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div role="progressbar" aria-label={label} className={className ? `m3-linear-progress ${className}` : 'm3-linear-progress'}>
      <span className="m3-linear-progress__bar" />
      <span className="m3-linear-progress__track" />
    </div>
  );
}
