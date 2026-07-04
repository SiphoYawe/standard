# Monthly digest — email template

The body scenario 2 ([`scenario-monthly-digest.md`](./scenario-monthly-digest.md))
fills from the `DigestPayload` returned by `GET /api/digest`. Every field below
is **already computed by the API** — the template only places values. No maths,
no ranking, no wording is done in Make (AD-7).

`{{...}}` tokens map to the payload; `data` is `{{2.data}}` in the scenario.

---

## Subject

```
{{data.subject}}
```

(The API pre-writes this, e.g. `Standard — July 2026: 2 money-losers, GBP 7,900 in hidden losses uncovered`.)

## Body (HTML)

```html
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">

  <h1 style="font-size: 20px; margin: 0 0 4px;">Your Standard digest — {{data.period}}</h1>
  <p style="font-size: 15px; color: #4b5563; margin: 0 0 20px;">{{data.headline}}</p>

  <!-- KPI summary -->
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <tr>
      <td style="padding: 12px; background: #f3f4f6; border-radius: 8px;">
        <div style="font-size: 12px; color: #6b7280;">Hidden losses uncovered</div>
        <div style="font-size: 18px; font-weight: 700;">{{data.baseCurrency}} {{data.kpis.hiddenLossesUncovered}}</div>
      </td>
      <td style="padding: 12px; background: #f3f4f6; border-radius: 8px;">
        <div style="font-size: 12px; color: #6b7280;">Money-losers</div>
        <div style="font-size: 18px; font-weight: 700;">{{data.kpis.moneyLoserCount}}</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 12px; background: #f3f4f6; border-radius: 8px;">
        <div style="font-size: 12px; color: #6b7280;">Blended true margin</div>
        <div style="font-size: 18px; font-weight: 700;">{{data.baseCurrency}} {{data.kpis.blendedStandard}}</div>
      </td>
      <td style="padding: 12px; background: #f3f4f6; border-radius: 8px;">
        <div style="font-size: 12px; color: #6b7280;">Revenue at risk</div>
        <div style="font-size: 18px; font-weight: 700;">{{data.baseCurrency}} {{data.kpis.revenueAtRisk}}</div>
      </td>
    </tr>
  </table>

  <!-- Ranked money-losers -->
  <h2 style="font-size: 16px; margin: 0 0 12px;">Accounts costing you money (worst first)</h2>

  <!-- REPEATED PER money-loser: Iterator over data.moneyLosers, aggregated with a Text aggregator.
       item = {{4.*}} inside the Iterator (see scenario 2, module 4a/4b). -->
  <div style="border-left: 4px solid #dc2626; padding: 10px 14px; margin-bottom: 14px; background: #fef2f2; border-radius: 0 8px 8px 0;">
    <div style="font-weight: 700; font-size: 15px;">
      {{item.customerName}} — {{item.currency}} {{item.trueMargin}}
      <span style="font-weight: 400; color: #6b7280; font-size: 13px;">(revenue {{item.currency}} {{item.revenue}}, confidence: {{item.confidence}})</span>
    </div>
    <div style="font-size: 14px; color: #374151; margin: 6px 0;">{{item.why}}</div>
    <div style="font-size: 14px; font-weight: 600; color: #b91c1c;">→ {{item.recommendedAction}}</div>
  </div>
  <!-- END repeated block -->

  <!-- Top performer (positive close) -->
  <p style="font-size: 14px; color: #065f46; background: #ecfdf5; padding: 10px 14px; border-radius: 8px;">
    Your strongest account this period: <strong>{{data.topPerformer.customerName}}</strong>
    at {{data.topPerformer.currency}} {{data.topPerformer.trueMargin}} true margin.
  </p>

  <p style="font-size: 13px; color: #6b7280; margin-top: 24px;">
    Numbers are from the {{data.period}} verdict (snapshot {{data.snapshotId}}, generated {{data.generatedAt}}).
    Repricing drafts flagged "draft ready" are waiting in your Standard dashboard — review before sending; nothing is auto-sent.
  </p>

</div>
```

## Plain-text fallback (optional)

```
Your Standard digest — {{data.period}}
{{data.headline}}

KPIs
- Hidden losses uncovered: {{data.baseCurrency}} {{data.kpis.hiddenLossesUncovered}}
- Money-losers: {{data.kpis.moneyLoserCount}}
- Blended true margin: {{data.baseCurrency}} {{data.kpis.blendedStandard}}
- Revenue at risk: {{data.baseCurrency}} {{data.kpis.revenueAtRisk}}

Accounts costing you money (worst first):
[repeat per data.moneyLosers]
  * {{item.customerName}} — {{item.currency}} {{item.trueMargin}} (revenue {{item.currency}} {{item.revenue}}, {{item.confidence}} confidence)
    {{item.why}}
    -> {{item.recommendedAction}}

Strongest account: {{data.topPerformer.customerName}} ({{data.topPerformer.currency}} {{data.topPerformer.trueMargin}})

From the {{data.period}} verdict — snapshot {{data.snapshotId}}.
Repricing drafts are waiting in your dashboard; nothing is auto-sent.
```

## Notes

- **Formatting only.** If you want currency symbols or grouped thousands beyond
  what the payload already provides in `recommendedAction`/`subject`, do it with
  Make's string functions in the mapping — do not recompute any amount.
- The per-money-loser block is rendered by an **Iterator + Text aggregator**
  (scenario 2, modules 4a–4b); the aggregated text drops into
  `Accounts costing you money`.
- If `data.moneyLosers` is empty, the header still reads well
  (`headline` says "every account is profitable this period") — you may hide the
  ranked section with a filter on `{{data.kpis.moneyLoserCount}} > 0`.
