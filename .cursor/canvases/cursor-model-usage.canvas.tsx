/**
 * Cursor Analytics — model usage, conversation insights & AI impact canvas.
 *
 * Data lineage: every number on this canvas comes from the data sidecar
 * `cursor-model-usage.canvas.data.json`, written by
 * `scripts/cursor-analytics-refresh.mjs`, which pulls directly from the
 * Cursor Analytics API (/analytics/team/*), Conversation Insights
 * (/analytics/team/conversation-insights), the AI Code Tracking API
 * (/analytics/ai-code/commits — git-level attribution), and the Admin API
 * (/teams/members, /teams/spend). Nothing is fetched from the canvas itself.
 *
 * Refresh: run `/refresh-analytics` in Cursor chat, or
 * `node scripts/cursor-analytics-refresh.mjs` from the repo root. A launchd
 * job (scripts/cursor-analytics-install-launchd.sh) refreshes daily at 07:30.
 * The header shows exactly how old the data is.
 */
import {
  BarChart,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Divider,
  Grid,
  H1,
  H2,
  LineChart,
  PieChart,
  Pill,
  Row,
  Spacer,
  Stack,
  Stat,
  Table,
  Text,
  UsageBar,
  useCanvasAction,
  useCanvasState,
  useHostTheme,
} from 'cursor/canvas';

// ---------------------------------------------------------------------------
// Payload types — mirrors scripts/cursor-analytics-refresh.mjs output
// ---------------------------------------------------------------------------

type Tone = 'success' | 'warning' | 'info' | 'neutral';

interface DailyRow {
  date: string;
  label: string;
  dau: number | null;
  cliDau: number | null;
  cloudAgentDau: number | null;
  bugbotDau: number | null;
  agentSuggested: number | null;
  agentAccepted: number | null;
  tabSuggestions: number | null;
  tabAccepts: number | null;
  messages: number | null;
  aiCommitLines: number | null;
  totalCommitLines: number | null;
}

interface SourceRow {
  id: string;
  label: string;
  endpoint: string;
  status: 'ok' | 'empty' | 'error' | 'skipped';
  detail?: string;
}

interface LabelCount {
  label: string;
  count: number;
}

interface WeeklySeries {
  categories: string[];
  series: Array<{ name: string; data: number[] }>;
}

interface Dashboard {
  schemaVersion: string;
  generatedAt: string;
  sampleMode: boolean;
  anonymized: boolean;
  window: { days: number; startDate: string; endDate: string };
  team: { memberCount: number | null; dauPeak: number | null };
  sources: SourceRow[];
  kpis: {
    dauLatest: number | null;
    dauAvg7: number | null;
    dauWoWPct: number | null;
    agentLinesAccepted: number | null;
    agentAcceptRatePct: number | null;
    agentAcceptRateWoWPts: number | null;
    tabAcceptRatePct: number | null;
    tabAccepts: number | null;
    aiMessages: number | null;
    conversations: number | null;
    aiCommitSharePct: number | null;
    spendCycleDollars: number | null;
  };
  daily: DailyRow[];
  models: {
    totals: Array<{ model: string; messages: number; peakDailyUsers: number | null; sharePct: number | null }>;
    otherMessages: number;
    weekly: WeeklySeries;
    topModel: { model: string; sharePct: number | null } | null;
    rising: { model: string; growthPct: number; prevMessages: number; currMessages: number } | null;
  } | null;
  conversationInsights: {
    totalConversations: number;
    intents: LabelCount[];
    complexity: LabelCount[];
    categories: LabelCount[];
    guidanceLevels: LabelCount[];
    workTypes: LabelCount[];
    workTypesWeekly: WeeklySeries | null;
    complexityDaily: Array<{ date: string; highSharePct: number | null; total: number }>;
    subcategories: { askMode: LabelCount[]; planMode: LabelCount[]; writeCode: LabelCount[] } | null;
  } | null;
  aiCode: {
    commitsAnalyzed: number;
    totalCountReported: number;
    totalLinesAdded: number;
    aiLinesAdded: number;
    tabLinesAdded: number;
    composerLinesAdded: number;
    nonAiLinesAdded: number;
    aiSharePct: number | null;
    primaryBranchAiSharePct: number | null;
    bySource: Array<{ source: string; commits: number; linesAdded: number; aiSharePct: number | null }>;
    topRepos: Array<{ repo: string; commits: number; linesAdded: number; aiSharePct: number | null }>;
  } | null;
  adoption: {
    mcpTop: Array<{ server: string; tool: string; usage: number }>;
    mcpTotal: number;
    mcpServers: number;
    commandsTop: Array<{ name: string; usage: number }>;
    skillsTop: Array<{ name: string; usage: number }>;
    planUsage: number | null;
    askUsage: number | null;
  } | null;
  people: {
    leaderboard: Array<{ rank: number; name: string; linesAccepted: number; linesSuggested: number; acceptRatePct: number | null }>;
    totalUsers: number | null;
    clientVersions: Array<{ version: string; users: number }>;
  } | null;
  fileExtensions: Array<{ ext: string; linesAccepted: number; sharePct: number | null }> | null;
  spend: {
    cycleStartDate: string | null;
    totalDollars: number | null;
    onDemandDollars: number | null;
    members: number;
    topSpenders: Array<{ name: string; dollars: number | null }>;
  } | null;
  bugbot: {
    prsReviewed: number;
    reviews: number;
    issuesFound: number;
    issuesResolved: number;
    resolvedRatePct: number | null;
    highSeverity: number;
    truncated: boolean;
  } | null;
  correlations: Array<{
    id: string;
    label: string;
    r: number;
    n: number;
    strength: 'strong' | 'moderate' | 'weak';
    direction: 'positive' | 'negative';
    interpretation: string;
  }>;
  insights: Array<{ title: string; detail: string; tone: Tone }>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n}%`;
}

function fmtDollars(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function ageOf(generatedAt: string): { label: string; hours: number } {
  const ms = Date.now() - new Date(generatedAt).getTime();
  const hours = ms / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return { label: 'just now', hours: 0 };
  if (hours < 1) return { label: `${Math.max(1, Math.round(hours * 60))} min ago`, hours };
  if (hours < 48) return { label: `${Math.round(hours)} h ago`, hours };
  return { label: `${Math.round(hours / 24)} d ago`, hours };
}

function midDateLabels(daily: DailyRow[]): string[] {
  // Thin the x-axis: show ~10 labels for a 30-day window.
  const step = Math.max(1, Math.ceil(daily.length / 10));
  return daily.map((d, i) => (i % step === 0 || i === daily.length - 1 ? d.label : ''));
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function DeltaText({ value, suffix, invert }: { value: number | null; suffix: string; invert?: boolean }) {
  const theme = useHostTheme();
  if (value === null || !Number.isFinite(value)) return null;
  const good = invert ? value < 0 : value > 0;
  const color = value === 0 ? theme.text.tertiary : good ? theme.diff.stripAdded : theme.diff.stripRemoved;
  const sign = value > 0 ? '+' : '';
  return (
    <Text size="small" weight="medium" style={{ color }}>
      {sign}
      {value}
      {suffix}
    </Text>
  );
}

function SectionCaption({ children }: { children: string }) {
  return (
    <Text size="small" tone="quaternary">
      {children}
    </Text>
  );
}

function InsightRows({ insights }: { insights: Dashboard['insights'] }) {
  const theme = useHostTheme();
  const toneColor = (tone: Tone): string => {
    switch (tone) {
      case 'success':
        return theme.diff.stripAdded;
      case 'warning':
        return theme.diff.stripRemoved;
      case 'info':
        return theme.accent.primary;
      default:
        return theme.text.tertiary;
    }
  };
  return (
    <Stack gap={14}>
      {insights.map((ins, i) => (
        <Row key={ins.title} gap={12} align="start">
          <Text
            size="small"
            weight="semibold"
            style={{ width: 26, flexShrink: 0, fontFamily: 'monospace', color: toneColor(ins.tone), lineHeight: '20px' }}
          >
            {String(i + 1).padStart(2, '0')}
          </Text>
          <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
            <Text weight="semibold">{ins.title}</Text>
            <Text tone="secondary" size="small">
              {ins.detail}
            </Text>
          </Stack>
        </Row>
      ))}
    </Stack>
  );
}

function DistributionList({ title, rows }: { title: string; rows: LabelCount[] }) {
  const theme = useHostTheme();
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <Stack gap={8} style={{ flex: 1, minWidth: 180 }}>
      <Text size="small" weight="semibold" tone="secondary">
        {title}
      </Text>
      <Stack gap={6}>
        {rows.slice(0, 5).map((r) => {
          const share = total > 0 ? (r.count / total) * 100 : 0;
          return (
            <Stack key={r.label} gap={3}>
              <Row gap={8} justify="space-between">
                <Text size="small" truncate style={{ flex: 1, minWidth: 0 }}>
                  {r.label}
                </Text>
                <Text size="small" tone="tertiary">
                  {share >= 1 ? `${Math.round(share)}%` : '<1%'}
                </Text>
              </Row>
              <div style={{ height: 4, borderRadius: 2, background: theme.fill.quaternary, overflow: 'hidden' }}>
                <div style={{ width: `${share}%`, height: '100%', background: theme.accent.primary, opacity: 0.75 }} />
              </div>
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  const dispatch = useCanvasAction();
  return (
    <Stack gap={18}>
      <Stack gap={6}>
        <Text tone="tertiary" size="small" weight="semibold">
          CURSOR ANALYTICS
        </Text>
        <H1>No analytics data loaded</H1>
        <Text tone="secondary">
          This canvas renders the data sidecar `cursor-model-usage.canvas.data.json`, produced by
          `scripts/cursor-analytics-refresh.mjs` straight from the Cursor Analytics, Conversation Insights, AI Code
          Tracking, and Admin APIs.
        </Text>
      </Stack>
      <Callout tone="info" title="Load real data">
        Run `/refresh-analytics` in chat, or `node scripts/cursor-analytics-refresh.mjs` from the repo root. Requires an
        admin-scoped team API key (`admin:*`) from cursor.com/dashboard → API Keys, stored as `CURSOR_ADMIN_KEY` (env or
        `~/.config/cursor-analytics/env`). For a customer-safe walkthrough without team data, run with `--sample`.
      </Callout>
      <Row gap={8}>
        <Button
          variant="primary"
          onClick={() =>
            dispatch({
              type: 'newComposerChat',
              userPrompt:
                'Refresh the Cursor analytics canvas: run `node scripts/cursor-analytics-refresh.mjs` from the repo root and summarize which sources succeeded.',
            })
          }
        >
          Refresh data
        </Button>
        <Button variant="secondary" onClick={() => dispatch({ type: 'openFile', path: 'scripts/cursor-analytics-refresh.mjs' })}>
          Open refresh script
        </Button>
      </Row>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Header({ d }: { d: Dashboard }) {
  const dispatch = useCanvasAction();
  const age = ageOf(d.generatedAt);
  const fresh = age.hours <= 26;
  return (
    <Stack gap={10}>
      <Text tone="tertiary" size="small" weight="semibold">
        CURSOR ANALYTICS · {d.window.startDate} → {d.window.endDate}
      </Text>
      <H1 style={{ margin: 0 }}>Cursor usage, insights & AI impact</H1>
      <Row gap={8} align="center" wrap>
        <Pill active={fresh} size="sm">
          {fresh ? `Data fresh · ${age.label}` : `Data stale · ${age.label}`}
        </Pill>
        {d.team.memberCount !== null ? (
          <Text size="small" tone="tertiary">
            Team of {d.team.memberCount}
          </Text>
        ) : null}
        <Text size="small" tone="tertiary">
          {d.window.days}-day window · refreshed daily at 07:30 via launchd
        </Text>
        {d.anonymized && !d.sampleMode ? (
          <Text size="small" tone="tertiary">
            Names anonymized for demo
          </Text>
        ) : null}
        <Spacer />
        <Button
          variant="secondary"
          onClick={() =>
            dispatch({
              type: 'newComposerChat',
              userPrompt:
                'Refresh the Cursor analytics canvas: run `node scripts/cursor-analytics-refresh.mjs` from the repo root and summarize which sources succeeded.',
            })
          }
        >
          Refresh now
        </Button>
      </Row>
      {d.sampleMode ? (
        <Callout tone="warning" title="Sample data">
          Every number below is generated demo data (run without `--sample` and with an admin-scoped API key to load your
          team's real analytics). Shapes and sections match the live pipeline exactly.
        </Callout>
      ) : null}
      {!fresh && !d.sampleMode ? (
        <Callout tone="warning" title="Data older than a day">
          The daily refresh may not have run. Trigger it manually with `/refresh-analytics` or check
          `~/Library/Logs/cursor-analytics-refresh.log`.
        </Callout>
      ) : null}
    </Stack>
  );
}

function KpiStrip({ d }: { d: Dashboard }) {
  const k = d.kpis;
  const cells: Array<{ value: string; label: string; tone?: 'success' | 'danger' | 'warning' | 'info' }> = [];
  if (k.dauLatest !== null) cells.push({ value: fmtInt(k.dauLatest), label: `Daily active devs${k.dauWoWPct !== null ? ` (${k.dauWoWPct > 0 ? '+' : ''}${k.dauWoWPct}% WoW)` : ''}` });
  if (k.agentLinesAccepted !== null) cells.push({ value: fmtCompact(k.agentLinesAccepted), label: `AI lines accepted · ${d.window.days}d` });
  if (k.agentAcceptRatePct !== null)
    cells.push({
      value: fmtPct(k.agentAcceptRatePct),
      label: `Agent line acceptance${k.agentAcceptRateWoWPts !== null ? ` (${k.agentAcceptRateWoWPts > 0 ? '+' : ''}${k.agentAcceptRateWoWPts} pts WoW)` : ''}`,
      tone: k.agentAcceptRateWoWPts !== null && k.agentAcceptRateWoWPts < -1 ? 'warning' : undefined,
    });
  if (k.aiCommitSharePct !== null) cells.push({ value: fmtPct(k.aiCommitSharePct), label: 'AI share of committed code', tone: 'success' });
  if (k.conversations !== null) cells.push({ value: fmtCompact(k.conversations), label: 'Conversations analyzed' });
  if (k.aiMessages !== null) cells.push({ value: fmtCompact(k.aiMessages), label: 'Agent messages' });
  if (k.tabAcceptRatePct !== null && cells.length < 6) cells.push({ value: fmtPct(k.tabAcceptRatePct), label: 'Tab acceptance' });
  if (k.spendCycleDollars !== null && cells.length < 6) cells.push({ value: fmtDollars(k.spendCycleDollars), label: 'Spend this cycle' });
  if (cells.length === 0) return null;
  return (
    <Grid columns={3} gap={16}>
      {cells.slice(0, 6).map((c) => (
        <Stat key={c.label} value={c.value} label={c.label} tone={c.tone} />
      ))}
    </Grid>
  );
}

function ModelSection({ d }: { d: Dashboard }) {
  const m = d.models;
  if (!m || m.totals.length === 0) return null;
  const pieData = m.totals.slice(0, 6).map((t) => ({ label: t.model, value: t.messages }));
  if (m.otherMessages > 0 || m.totals.length > 6) {
    const shown = pieData.reduce((a, p) => a + p.value, 0);
    const all = m.totals.reduce((a, t) => a + t.messages, 0) + m.otherMessages;
    if (all - shown > 0) pieData.push({ label: 'Other', value: all - shown });
  }
  return (
    <Stack gap={14}>
      <H2>Model usage</H2>
      <Text tone="secondary" size="small">
        Which models the team runs, and how the mix is shifting week to week.
        {m.rising ? ` ${m.rising.model} is the fastest riser: +${m.rising.growthPct}% WoW.` : ''}
      </Text>
      <Row gap={24} align="start" wrap>
        <Stack gap={8} style={{ flex: 2, minWidth: 320 }}>
          <Text size="small" weight="semibold" tone="secondary">
            Agent messages per week by model
          </Text>
          <BarChart categories={m.weekly.categories} series={m.weekly.series} stacked height={220} />
        </Stack>
        <Stack gap={8} style={{ flex: 1, minWidth: 220 }}>
          <Text size="small" weight="semibold" tone="secondary">
            Share of messages · {d.window.days}d
          </Text>
          <PieChart data={pieData} donut size={190} />
        </Stack>
      </Row>
      <Table
        headers={['Model', 'Messages', 'Peak daily devs', 'Share']}
        columnAlign={['left', 'right', 'right', 'right']}
        rows={m.totals.map((t) => [t.model, fmtInt(t.messages), fmtInt(t.peakDailyUsers), fmtPct(t.sharePct)])}
        striped
      />
      <SectionCaption>Source: GET /analytics/team/models (Analytics API). Messages = agent requests attributed to each model.</SectionCaption>
    </Stack>
  );
}

function OutputSection({ d }: { d: Dashboard }) {
  const daily = d.daily;
  const hasAgent = daily.some((r) => (r.agentSuggested ?? 0) > 0);
  if (!hasAgent) return null;
  const cats = midDateLabels(daily);
  const suggested = daily.map((r) => r.agentSuggested ?? 0);
  const accepted = daily.map((r) => r.agentAccepted ?? 0);
  const acceptedTotal = accepted.reduce((a, b) => a + b, 0);
  const suggestedTotal = suggested.reduce((a, b) => a + b, 0);
  const agentRate = daily.map((r) => ((r.agentSuggested ?? 0) > 0 ? Math.round(((r.agentAccepted ?? 0) / (r.agentSuggested ?? 1)) * 1000) / 10 : 0));
  const tabRate = daily.map((r) => ((r.tabSuggestions ?? 0) > 0 ? Math.round(((r.tabAccepts ?? 0) / (r.tabSuggestions ?? 1)) * 1000) / 10 : 0));
  const hasTab = daily.some((r) => (r.tabSuggestions ?? 0) > 0);
  return (
    <Stack gap={14}>
      <H2>AI output & acceptance</H2>
      <Text tone="secondary" size="small">
        Volume of AI-suggested code and how much of it developers actually keep.
      </Text>
      <Stack gap={8}>
        <Text size="small" weight="semibold" tone="secondary">
          Agent lines per day — suggested vs accepted
        </Text>
        <LineChart
          categories={cats}
          series={[
            { name: 'Suggested', data: suggested, tone: 'info' },
            { name: 'Accepted', data: accepted, tone: 'success' },
          ]}
          fill
          height={200}
        />
      </Stack>
      <Row gap={24} align="start" wrap>
        <Stack gap={8} style={{ flex: 1, minWidth: 300 }}>
          <Text size="small" weight="semibold" tone="secondary">
            Acceptance rate per day (%)
          </Text>
          <LineChart
            categories={cats}
            series={[
              { name: 'Agent lines', data: agentRate, tone: 'success' },
              ...(hasTab ? [{ name: 'Tab suggestions', data: tabRate, tone: 'info' as const }] : []),
            ]}
            valueSuffix="%"
            beginAtZero={false}
            height={170}
          />
        </Stack>
        <Stack gap={10} style={{ flex: 1, minWidth: 260 }}>
          <Text size="small" weight="semibold" tone="secondary">
            {d.window.days}-day agent lines
          </Text>
          <UsageBar
            total={suggestedTotal}
            topLeftLabel={`${fmtPct(d.kpis.agentAcceptRatePct)} accepted`}
            topRightLabel={`${fmtCompact(acceptedTotal)} / ${fmtCompact(suggestedTotal)} lines`}
            segments={[{ id: 'accepted', value: acceptedTotal, color: 'green' }]}
          />
          {hasTab ? (
            <Text size="small" tone="tertiary">
              Tab: {fmtCompact(d.kpis.tabAccepts)} completions accepted ({fmtPct(d.kpis.tabAcceptRatePct)} of shown).
            </Text>
          ) : null}
        </Stack>
      </Row>
      <SectionCaption>Sources: GET /analytics/team/agent-edits, /analytics/team/tabs (Analytics API). Lines = green + red lines in suggested/accepted diffs.</SectionCaption>
    </Stack>
  );
}

function ConversationSection({ d }: { d: Dashboard }) {
  const ci = d.conversationInsights;
  if (!ci || ci.totalConversations === 0) return null;
  const complexityOrder = ['low', 'medium', 'high'];
  const complexity = [...ci.complexity].sort(
    (a, b) => complexityOrder.indexOf(a.label.toLowerCase()) - complexityOrder.indexOf(b.label.toLowerCase()),
  );
  return (
    <Stack gap={14}>
      <H2>Conversation insights</H2>
      <Text tone="secondary" size="small">
        On-device classification of {fmtInt(ci.totalConversations)} agent conversations: what kind of work the team
        delegates, how complex it is, and how much guidance developers give.
      </Text>
      <Row gap={24} align="start" wrap>
        <Stack gap={8} style={{ minWidth: 210 }}>
          <Text size="small" weight="semibold" tone="secondary">
            Intent
          </Text>
          <PieChart data={ci.intents.map((i) => ({ label: i.label, value: i.count }))} donut size={180} />
        </Stack>
        <Stack gap={8} style={{ flex: 1, minWidth: 240 }}>
          <Text size="small" weight="semibold" tone="secondary">
            Task complexity
          </Text>
          <BarChart
            categories={complexity.map((c) => c.label)}
            series={[{ name: 'Conversations', data: complexity.map((c) => c.count) }]}
            height={170}
            showValues
          />
        </Stack>
        <DistributionList title="Work category (segments)" rows={ci.categories} />
        <DistributionList title="Guidance level" rows={ci.guidanceLevels} />
      </Row>
      {ci.workTypesWeekly && ci.workTypesWeekly.categories.length >= 2 ? (
        <Stack gap={8}>
          <Text size="small" weight="semibold" tone="secondary">
            Work type mix over time (share of segments)
          </Text>
          <BarChart categories={ci.workTypesWeekly.categories} series={ci.workTypesWeekly.series} normalized height={190} />
        </Stack>
      ) : null}
      {ci.subcategories ? (
        <Stack gap={2}>
          {(
            [
              ['Write Code — top subcategories', ci.subcategories.writeCode],
              ['Ask — top subcategories', ci.subcategories.askMode],
              ['Plan — top subcategories', ci.subcategories.planMode],
            ] as Array<[string, LabelCount[]]>
          )
            .filter(([, rows]) => rows.length > 0)
            .map(([title, rows]) => (
              <CollapsibleSection key={title} title={title} count={rows.length}>
                <Table
                  headers={['Subcategory', 'Conversations']}
                  columnAlign={['left', 'right']}
                  rows={rows.map((r) => [r.label, fmtInt(r.count)])}
                  framed={false}
                />
              </CollapsibleSection>
            ))}
        </Stack>
      ) : null}
      <SectionCaption>Source: GET /analytics/team/conversation-insights (Analytics API, Enterprise). Intents & complexity describe whole conversations; categories, guidance and work types describe conversation segments. Classification runs on-device; aggregates only.</SectionCaption>
    </Stack>
  );
}

function ShipSection({ d }: { d: Dashboard }) {
  const ai = d.aiCode;
  if (!ai) return null;
  const daily = d.daily;
  const hasDailyCommits = daily.some((r) => (r.totalCommitLines ?? 0) > 0);
  const cats = midDateLabels(daily);
  return (
    <Stack gap={14}>
      <H2>From suggestion to shipped code</H2>
      <Text tone="secondary" size="small">
        Git-level attribution: how much of the code that actually lands in commits was written by Cursor (Tab + Agent),
        across {fmtInt(ai.commitsAnalyzed)} commits.
      </Text>
      <Grid columns={3} gap={16}>
        <Stat value={fmtPct(ai.aiSharePct)} label="AI share of added lines" tone="success" />
        <Stat value={fmtPct(ai.primaryBranchAiSharePct)} label="AI share on primary branches" />
        <Stat value={fmtCompact(ai.aiLinesAdded)} label={`AI lines committed · ${d.window.days}d`} />
      </Grid>
      <Stack gap={10}>
        <UsageBar
          total={ai.totalLinesAdded}
          topLeftLabel="Committed lines by author"
          topRightLabel={`${fmtCompact(ai.totalLinesAdded)} lines added`}
          segments={[
            { id: 'agent', value: ai.composerLinesAdded, color: 'purple' },
            { id: 'tab', value: ai.tabLinesAdded, color: 'blue' },
          ]}
        />
        <Row gap={16} wrap>
          <Text size="small" tone="tertiary">
            Agent {fmtCompact(ai.composerLinesAdded)} · Tab {fmtCompact(ai.tabLinesAdded)} · Human{' '}
            {fmtCompact(ai.nonAiLinesAdded)}
          </Text>
        </Row>
      </Stack>
      {hasDailyCommits ? (
        <Stack gap={8}>
          <Text size="small" weight="semibold" tone="secondary">
            Accepted AI lines vs AI lines landing in commits (daily)
          </Text>
          <LineChart
            categories={cats}
            series={[
              { name: 'Accepted in editor', data: daily.map((r) => r.agentAccepted ?? 0), tone: 'info' },
              { name: 'AI lines committed', data: daily.map((r) => r.aiCommitLines ?? 0), tone: 'success' },
            ]}
            height={190}
          />
        </Stack>
      ) : null}
      <Row gap={24} align="start" wrap>
        <Stack gap={8} style={{ flex: 1, minWidth: 260 }}>
          <Text size="small" weight="semibold" tone="secondary">
            By commit source
          </Text>
          <Table
            headers={['Source', 'Commits', 'Lines added', 'AI share']}
            columnAlign={['left', 'right', 'right', 'right']}
            rows={ai.bySource.map((s) => [s.source.toUpperCase(), fmtInt(s.commits), fmtCompact(s.linesAdded), fmtPct(s.aiSharePct)])}
          />
        </Stack>
        {ai.topRepos.length > 0 ? (
          <Stack gap={8} style={{ flex: 1, minWidth: 280 }}>
            <Text size="small" weight="semibold" tone="secondary">
              Top repositories
            </Text>
            <Table
              headers={['Repository', 'Commits', 'AI share']}
              columnAlign={['left', 'right', 'right']}
              rows={ai.topRepos.map((r) => [r.repo, fmtInt(r.commits), fmtPct(r.aiSharePct)])}
            />
          </Stack>
        ) : null}
      </Row>
      <SectionCaption>Source: GET /analytics/ai-code/commits (AI Code Tracking API, Enterprise alpha). AI lines = Tab + Agent lines per commit; non-AI derived as total − AI.</SectionCaption>
    </Stack>
  );
}

function CorrelationSection({ d }: { d: Dashboard }) {
  if (d.correlations.length === 0) return null;
  const toneFor = (c: Dashboard['correlations'][number]): 'success' | 'info' | 'neutral' =>
    c.strength === 'strong' ? 'success' : c.strength === 'moderate' ? 'info' : 'neutral';
  return (
    <Stack gap={14}>
      <H2>Correlated signals</H2>
      <Text tone="secondary" size="small">
        Pearson correlations across daily values in the window — how the metrics move together.
      </Text>
      <Table
        headers={['Signal pair', 'r', 'n (days)', 'Strength', 'Read']}
        columnAlign={['left', 'right', 'right', 'left', 'left']}
        rowTone={d.correlations.map(toneFor)}
        rows={d.correlations.map((c) => [
          c.label,
          `${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)}`,
          String(c.n),
          c.strength,
          <Text key={c.id} size="small" tone="secondary">
            {c.interpretation}
          </Text>,
        ])}
      />
      <SectionCaption>Computed by the refresh script from the daily series above. Correlation is not causation; treat weak |r| &lt; 0.25 as noise.</SectionCaption>
    </Stack>
  );
}

function AdoptionSection({ d }: { d: Dashboard }) {
  const a = d.adoption;
  if (!a) return null;
  return (
    <Stack gap={14}>
      <H2>Workflow adoption</H2>
      <Text tone="secondary" size="small">
        How deeply Cursor is wired into the team's systems and workflows: MCP tools, custom commands, skills, and modes.
      </Text>
      <Row gap={24} align="start" wrap>
        {a.mcpTop.length > 0 ? (
          <Stack gap={8} style={{ flex: 2, minWidth: 300 }}>
            <Text size="small" weight="semibold" tone="secondary">
              MCP tools · {fmtInt(a.mcpTotal)} calls across {a.mcpServers} servers
            </Text>
            <Table
              headers={['Server', 'Tool', 'Calls']}
              columnAlign={['left', 'left', 'right']}
              rows={a.mcpTop.map((t) => [t.server, t.tool, fmtInt(t.usage)])}
              striped
            />
          </Stack>
        ) : null}
        <Stack gap={16} style={{ flex: 1, minWidth: 220 }}>
          {a.commandsTop.length > 0 ? (
            <Stack gap={8}>
              <Text size="small" weight="semibold" tone="secondary">
                Commands
              </Text>
              <Table
                headers={['Command', 'Uses']}
                columnAlign={['left', 'right']}
                rows={a.commandsTop.map((c) => [c.name, fmtInt(c.usage)])}
              />
            </Stack>
          ) : null}
          {a.skillsTop.length > 0 ? (
            <Stack gap={8}>
              <Text size="small" weight="semibold" tone="secondary">
                Skills
              </Text>
              <Table headers={['Skill', 'Uses']} columnAlign={['left', 'right']} rows={a.skillsTop.map((s) => [s.name, fmtInt(s.usage)])} />
            </Stack>
          ) : null}
          {(a.planUsage ?? 0) > 0 || (a.askUsage ?? 0) > 0 ? (
            <Grid columns={2} gap={12}>
              <Stat value={fmtCompact(a.planUsage)} label="Plan mode uses" />
              <Stat value={fmtCompact(a.askUsage)} label="Ask mode uses" />
            </Grid>
          ) : null}
        </Stack>
      </Row>
      <SectionCaption>Sources: GET /analytics/team/mcp, /commands, /skills, /plans, /ask-mode (Analytics API).</SectionCaption>
    </Stack>
  );
}

function PeopleSection({ d }: { d: Dashboard }) {
  const p = d.people;
  if (!p) return null;
  return (
    <Stack gap={14}>
      <H2>People & environment</H2>
      <Row gap={24} align="start" wrap>
        {p.leaderboard.length > 0 ? (
          <Stack gap={8} style={{ flex: 2, minWidth: 320 }}>
            <Text size="small" weight="semibold" tone="secondary">
              Agent leaderboard · top {p.leaderboard.length}
              {p.totalUsers ? ` of ${p.totalUsers}` : ''}
              {d.anonymized ? ' (anonymized)' : ''}
            </Text>
            <Table
              headers={['#', 'Developer', 'AI lines accepted', 'Acceptance']}
              columnAlign={['right', 'left', 'right', 'right']}
              rows={p.leaderboard.map((u) => [String(u.rank), u.name, fmtInt(u.linesAccepted), fmtPct(u.acceptRatePct)])}
              striped
            />
          </Stack>
        ) : null}
        <Stack gap={16} style={{ flex: 1, minWidth: 220 }}>
          {p.clientVersions.length > 0 ? (
            <Stack gap={8}>
              <Text size="small" weight="semibold" tone="secondary">
                Client versions (latest day)
              </Text>
              <Table
                headers={['Version', 'Users']}
                columnAlign={['left', 'right']}
                rows={p.clientVersions.map((v) => [v.version, fmtInt(v.users)])}
              />
            </Stack>
          ) : null}
          {d.fileExtensions && d.fileExtensions.length > 0 ? (
            <Stack gap={8}>
              <Text size="small" weight="semibold" tone="secondary">
                Where AI code lands (by accepted lines)
              </Text>
              <Table
                headers={['Extension', 'Lines', 'Share']}
                columnAlign={['left', 'right', 'right']}
                rows={d.fileExtensions.map((f) => [`.${f.ext}`, fmtCompact(f.linesAccepted), fmtPct(f.sharePct)])}
              />
            </Stack>
          ) : null}
        </Stack>
      </Row>
      <SectionCaption>Sources: GET /analytics/team/leaderboard, /client-versions, /top-file-extensions (Analytics API).</SectionCaption>
    </Stack>
  );
}

function SpendBugbotSection({ d }: { d: Dashboard }) {
  const s = d.spend;
  const b = d.bugbot;
  if (!s && !b) return null;
  return (
    <Stack gap={14}>
      <H2>Spend & code review</H2>
      <Row gap={24} align="start" wrap>
        {s ? (
          <Stack gap={10} style={{ flex: 1, minWidth: 280 }}>
            <Grid columns={2} gap={12}>
              <Stat value={fmtDollars(s.totalDollars)} label={`Spend this cycle${s.cycleStartDate ? ` (since ${s.cycleStartDate})` : ''}`} />
              <Stat value={fmtDollars(s.onDemandDollars)} label="Of which on-demand" />
            </Grid>
            {s.topSpenders.length > 0 ? (
              <Table
                headers={['Top spenders', 'Cycle spend']}
                columnAlign={['left', 'right']}
                rows={s.topSpenders.map((t) => [t.name, fmtDollars(t.dollars)])}
              />
            ) : null}
            <SectionCaption>Source: POST /teams/spend (Admin API). Includes on-demand plus included usage for the current billing cycle.</SectionCaption>
          </Stack>
        ) : null}
        {b ? (
          <Stack gap={10} style={{ flex: 1, minWidth: 280 }}>
            <Grid columns={3} gap={12}>
              <Stat value={fmtInt(b.prsReviewed)} label="PRs reviewed by Bugbot" />
              <Stat value={fmtInt(b.issuesFound)} label="Issues flagged" />
              <Stat value={fmtPct(b.resolvedRatePct)} label="Issues resolved" tone={b.resolvedRatePct !== null && b.resolvedRatePct >= 50 ? 'success' : undefined} />
            </Grid>
            <Text size="small" tone="tertiary">
              {fmtInt(b.highSeverity)} high-severity findings{b.truncated ? ' · first 250 PRs shown' : ''}.
            </Text>
            <SectionCaption>Source: GET /analytics/team/bugbot (Analytics API, all PR states).</SectionCaption>
          </Stack>
        ) : null}
      </Row>
    </Stack>
  );
}

function MethodologySection({ d }: { d: Dashboard }) {
  const theme = useHostTheme();
  const toneFor = (s: SourceRow): 'success' | 'danger' | 'neutral' | undefined =>
    s.status === 'ok' ? 'success' : s.status === 'error' ? 'danger' : 'neutral';
  const okCount = d.sources.filter((s) => s.status === 'ok').length;
  return (
    <CollapsibleSection
      title="Methodology & data sources"
      count={d.sources.length}
      trailing={
        <Text size="small" style={{ color: okCount === d.sources.length ? theme.diff.stripAdded : theme.text.tertiary }}>
          {okCount}/{d.sources.length} live
        </Text>
      }
    >
      <Stack gap={12} style={{ paddingTop: 8 }}>
        <Text size="small" tone="secondary">
          Refreshed by `scripts/cursor-analytics-refresh.mjs` (daily 07:30 via launchd, on demand via
          `/refresh-analytics`). All data comes straight from Cursor's first-party APIs over Basic auth with an
          admin-scoped team key — no third-party analytics layer. Generated {d.generatedAt} · schema v{d.schemaVersion}.
          The data sidecar is gitignored; nothing here is committed to the public repo or deployed to the website.
        </Text>
        <Table
          headers={['Source', 'Endpoint', 'Status']}
          columnAlign={['left', 'left', 'left']}
          rowTone={d.sources.map(toneFor)}
          rows={d.sources.map((s) => [
            s.label,
            <Text key={s.id} size="small" tone="tertiary">
              {s.endpoint}
            </Text>,
            s.status + (s.detail && s.status === 'error' ? ` — ${s.detail}` : ''),
          ])}
          striped
        />
      </Stack>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function CursorModelUsageCanvas() {
  const [dashboard] = useCanvasState<Dashboard | null>('dashboard', null);
  if (!dashboard) return <EmptyState />;

  return (
    <Stack gap={28}>
      <Header d={dashboard} />
      <KpiStrip d={dashboard} />
      {dashboard.insights.length > 0 ? (
        <Stack gap={14}>
          <H2>What the data says</H2>
          <InsightRows insights={dashboard.insights} />
        </Stack>
      ) : null}
      <Divider />
      <ModelSection d={dashboard} />
      <Divider />
      <OutputSection d={dashboard} />
      <Divider />
      <ConversationSection d={dashboard} />
      {dashboard.aiCode ? <Divider /> : null}
      <ShipSection d={dashboard} />
      {dashboard.correlations.length > 0 ? <Divider /> : null}
      <CorrelationSection d={dashboard} />
      {dashboard.adoption ? <Divider /> : null}
      <AdoptionSection d={dashboard} />
      {dashboard.people ? <Divider /> : null}
      <PeopleSection d={dashboard} />
      {dashboard.spend || dashboard.bugbot ? <Divider /> : null}
      <SpendBugbotSection d={dashboard} />
      <Divider />
      <MethodologySection d={dashboard} />
    </Stack>
  );
}
