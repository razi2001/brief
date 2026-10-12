import { IconGrip, IconMic, IconX } from "./icons";

/** The recording bar (bar.html): 3, 2, 1, then grip, stop, voice, timer, mic. */
export function MockBar({ count, time }: { count?: number; time?: string }) {
  return (
    <div className="gd-bar">
      {count !== undefined ? (
        <>
          <span key={count} className="cd">
            {count}
          </span>
          <span className="prompt">Describe your brief</span>
          <span className="ib">
            <IconX />
          </span>
        </>
      ) : (
        <>
          <span className="grip">
            <IconGrip />
          </span>
          <span data-gd="stop" className="stop">
            <i />
          </span>
          <span className="wave" aria-hidden="true">
            {Array.from({ length: 34 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <span className="timer">{time ?? "00:00"}</span>
          <span className="ib">
            <IconMic />
          </span>
        </>
      )}
    </div>
  );
}
