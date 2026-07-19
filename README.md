# ⛰ Sign To Erebor

A When2Meet-style group scheduler that doesn't explode when the date range is long.
One person forges a quest (date range + optional hour range); everyone else opens the
link and marks when they can make it — on a **calendar**, not a giant wall of cells.

## How it solves the When2Meet problem

- **Calendar view** — days are laid out as normal month calendars, so 30+ days stay compact.
- **Drill into a day** — in *days & hours* mode, clicking a day opens a panel where you
  paint the hours that work (click or drag). The day cell on the calendar shows the
  group heatmap and whether you've picked anything there.
- **Days-only mode** — if hours don't matter, the creator can make a days-only quest and
  people just click/drag whole days on the calendar.
- Group availability shows as a green heatmap; your own picks get a gold ring.
  A sidebar lists the best times/days and every member of the company.

## Run

```sh
node server.js        # or: npm start
# → http://localhost:3000
```

No dependencies — plain Node (built-in `http`), vanilla JS frontend.
Data is persisted to `data.json` next to the server.

## Notes

- Rejoining: enter the same name on the same event and you get your previous availability
  back (identity is also remembered per browser via localStorage).
- Range is capped at 92 days per event; slots are 1 hour or 30 minutes.
- Plans expire: once an event's last day has passed, it is deleted automatically
  (checked hourly and on every API request).
- The event page polls every 10 s, so you see companions' updates without refreshing.
- Optional per-name passwords protect availability from being edited by others; availability
  writes require the secret token issued on join.
- Two themes — "morning parchment" (light) and "evening at Bag End" (dark) — toggled from the
  top bar, persisted per browser, defaulting to the system preference (`?theme=light|dark`
  in the URL forces one).
- Event pages live at real paths (`/e/<id>`), and the server injects per-event Open Graph
  tags (quest name, dates, door image) so invite links unfurl nicely in chats. Old `#e/<id>`
  links redirect.
- A "there and back again" strip shows how many of the company have marked their days as a
  journey from the Shire to Erebor; fireworks fire once when everyone has.
- Headings are set in IM Fell English (SIL OFL, by Igino Marini), self-hosted in
  `public/fonts/`.
