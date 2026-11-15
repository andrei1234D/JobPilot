/** Styles for the in-page panel. Scoped by the shadow root, so plain class names are safe. */
export const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 330px; max-height: min(72vh, 620px); display: flex; flex-direction: column;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0b0b0b;
  background: #fcfcfb; border: 1px solid #c3c2b7; border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.18);
}
.panel.collapsed { width: auto; }
.header { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 10px; }
.panel:not(.collapsed) .header { border-bottom: 1px solid #e1e0d9; }
.title { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; flex: 1; padding: 4px 0; }
.title:focus-visible, .close:focus-visible, .save:focus-visible { outline: 2px solid #1c5cab; outline-offset: 2px; border-radius: 6px; }
.brand { font-weight: 700; color: #1c5cab; }
.count { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; }
.count.seen { background: #e3eefc; color: #1c5cab; }
.count.warn { background: #fdf1d3; color: #8a5a00; }
.count.block { background: #fbe6e4; color: #b3261e; }
.close { all: unset; cursor: pointer; padding: 4px 8px; color: #52514e; border-radius: 6px; }
.close:hover { background: #f0efec; }
.body { padding: 10px 12px 12px; overflow-y: auto; }
.posting { font-weight: 600; margin-bottom: 8px; overflow-wrap: anywhere; }
.heading { margin: 10px 0 5px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #898781; }
.note { margin: 0; color: #52514e; }
.note.ok { color: #006300; }
.note.offline { color: #8a5a00; background: #fdf1d3; padding: 6px 8px; border-radius: 8px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.row { border: 1px solid #e1e0d9; border-radius: 8px; padding: 6px 8px; background: #fff; }
.row-top { display: flex; align-items: center; gap: 6px; }
.pill { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: #f0efec; color: #52514e; }
.pill.rejected { background: #fbe6e4; color: #b3261e; }
.pill.waiting { background: #e3eefc; color: #1c5cab; }
.pill.interview, .pill.offer { background: #e1f3e1; color: #006300; }
.date { margin-left: auto; font-size: 11px; color: #52514e; }
.role { margin-top: 3px; font-weight: 500; overflow-wrap: anywhere; }
.hint { font-size: 11px; color: #52514e; overflow-wrap: anywhere; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #898781; }
.dot.block { background: #d03b3b; }
.dot.warn { background: #eda100; }
.flag-label { font-weight: 600; }
.evidence { margin-top: 3px; font-size: 11px; color: #52514e; overflow-wrap: anywhere; }
.save {
  all: unset; box-sizing: border-box; cursor: pointer; display: block; width: 100%; margin-top: 12px;
  text-align: center; padding: 7px 10px; border-radius: 8px; font-weight: 600; background: #1c5cab; color: #fff;
}
.save:disabled { cursor: default; background: #e1e0d9; color: #52514e; }
@media (prefers-color-scheme: dark) {
  .panel { color: #f0efec; background: #1a1a19; border-color: #383835; }
  .panel:not(.collapsed) .header { border-color: #2c2c2a; }
  .brand { color: #6da7ec; }
  .close { color: #c3c2b7; } .close:hover { background: #2c2c2a; }
  .note, .hint, .evidence, .date { color: #c3c2b7; }
  .note.ok { color: #4cc04c; }
  .row { background: #222220; border-color: #2c2c2a; }
  .pill { background: #2c2c2a; color: #c3c2b7; }
  .save:disabled { background: #2c2c2a; color: #898781; }
}
`;
