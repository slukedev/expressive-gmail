/** Shaped like real rows, so the list doesn't jump when mail arrives. */
export function ListSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div className="seg-list skeleton" aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row-wrap">
          <div className="row row--skeleton" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="row__lead">
              <span className="sk sk--circle" />
            </span>
            <span className="row__sender">
              <span className="sk sk--line" style={{ width: `${38 + ((i * 17) % 30)}%` }} />
            </span>
            <span className="row__main">
              <span className="sk sk--line" style={{ width: `${60 + ((i * 23) % 30)}%` }} />
              <span className="sk sk--line sk--faint" style={{ width: `${70 + ((i * 11) % 25)}%` }} />
            </span>
            <span className="row__trail">
              <span className="sk sk--line sk--short" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
