import React, { useState, useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import { 
  Dialog, DialogTitle, DialogContent, DialogActions, 
  Button, TextField, Typography, 
  makeStyles, Paper, Grid
} from '@material-ui/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// ─── Module-level constants (not recreated on every render) ──────────────────
const WORKER_URL = 'https://cdr-recommender.mr-shaun.workers.dev';

const GOAL_OPTIONS = [
  'Low Interest Rate',
  'Rewards & Points (Frequent Flyer)',
  'No Annual Fee',
  'Travel Benefits & Insurance',
  'Balance Transfer',
  'Cashback',
  'No Foreign Transaction Fees',
];

// Consumer-friendly taglines that cycle during the parallel analysis phase.
// Designed to reassure without exposing internal technical detail.
const PARALLEL_TAGLINES = [
  'Crunching the numbers on fees, rates & rewards…',
  'Checking your eligibility across all available cards…',
  'Weighing up what matters most for your goal…',
  'Almost there — comparing the fine print so you don\'t have to…',
];

// Agent definitions — each maps to a real API action and carries consumer-facing copy.
const AGENT_DEFINITIONS = [
  {
    id: 'pre',
    action: 'run_prescreen',
    label: 'Pre-Screener',
    description: 'Filtering all available market cards...',
    model: 'KIMI K2.7 (262K CONTEXT)',
    icon: '🔍',
  },
  {
    id: 'math',
    action: 'run_math',
    label: 'Value & Cost Analyst',
    description: 'Calculating fees, interest & estimated rewards return',
    model: 'DEEPSEEK V4 PRO (1.6T REASONING)',
    icon: '💰',
  },
  {
    id: 'risk',
    action: 'run_risk',
    label: 'Eligibility Checker',
    description: 'Verifying you qualify and flagging any hidden risks',
    model: 'DEEPSEEK V4 FLASH',
    icon: '🛡️',
  },
  {
    id: 'synth',
    action: 'run_synth',
    label: 'Recommendation Editor',
    description: 'Synthesising findings into your personalised shortlist',
    model: 'GPT-OSS-20B (OPENAI)',
    icon: '✨',
  },
];

// Possible status values for each agent row
const STATUS = { IDLE: 'idle', THINKING: 'thinking', DONE: 'done', ERROR: 'error' };

// Safely parse integer — handles 0 correctly (unlike `parseInt(x) || fallback`)
const parseIntSafe = (val, fallback) => {
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((theme) => ({
  dialog: {
    padding: theme.spacing(2),
  },
  disclaimerBox: {
    backgroundColor: '#fff3cd',
    color: '#856404',
    padding: theme.spacing(2),
    marginBottom: theme.spacing(3),
    borderLeft: '4px solid #ffeeba',
    borderRadius: '4px',
    '@media (prefers-color-scheme: dark)': {
      backgroundColor: '#451a03 !important',
      color: '#fed7aa !important',
      borderLeft: '4px solid #f97316',
    },
  },
  disclaimerTitle: {
    fontWeight: 'bold',
    marginBottom: theme.spacing(1),
  },
  noCdrWarning: {
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    padding: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
    borderLeft: '4px solid #3b82f6',
    borderRadius: '4px',
    fontSize: '0.875rem',
    '@media (prefers-color-scheme: dark)': {
      backgroundColor: '#1e3a5f',
      color: '#93c5fd',
    },
  },

  // ── Loading UI ──────────────────────────────────────────────────────────────
  loadingRoot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: theme.spacing(3, 1, 2),
    gap: theme.spacing(2.5),
  },
  loadingHeadline: {
    textAlign: 'center',
    fontWeight: 700,
    fontSize: '1.05rem',
    color: '#0f172a',
    letterSpacing: '-0.01em',
    minHeight: '1.4em',          // prevents layout jump during tagline cycling
    transition: 'opacity 0.4s ease',
    '@media (prefers-color-scheme: dark)': {
      color: '#f1f5f9',
    },
  },
  loadingSubline: {
    textAlign: 'center',
    fontSize: '0.8rem',
    color: '#64748b',
    marginTop: -theme.spacing(1.5),
    '@media (prefers-color-scheme: dark)': {
      color: '#94a3b8',
    },
  },

  // Agent card row
  agentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5, 2),
    borderRadius: '10px',
    background: 'rgba(248, 250, 252, 0.8)',
    border: '1px solid #e2e8f0',
    transition: 'border-color 0.3s ease, background 0.3s ease',
    '@media (prefers-color-scheme: dark)': {
      background: 'rgba(30, 41, 59, 0.7)',
      border: '1px solid #334155',
    },
  },
  agentRowThinking: {
    borderColor: '#3b82f6 !important',
    background: 'rgba(219, 234, 254, 0.4) !important',
    '@media (prefers-color-scheme: dark)': {
      background: 'rgba(30, 58, 95, 0.5) !important',
    },
  },
  agentRowDone: {
    borderColor: '#22c55e !important',
    background: 'rgba(240, 253, 244, 0.6) !important',
    '@media (prefers-color-scheme: dark)': {
      background: 'rgba(20, 83, 45, 0.35) !important',
    },
  },
  agentRowError: {
    borderColor: '#ef4444 !important',
    background: 'rgba(254, 242, 242, 0.6) !important',
    '@media (prefers-color-scheme: dark)': {
      background: 'rgba(69, 10, 10, 0.4) !important',
    },
  },
  agentIcon: {
    fontSize: '1.5rem',
    lineHeight: 1,
    flexShrink: 0,
    width: 36,
    textAlign: 'center',
  },
  agentMeta: {
    flex: 1,
    minWidth: 0,
  },
  agentLabel: {
    fontWeight: 600,
    fontSize: '0.875rem',
    color: '#1e293b',
    '@media (prefers-color-scheme: dark)': {
      color: '#f1f5f9',
    },
  },
  agentDesc: {
    fontSize: '0.75rem',
    color: '#64748b',
    marginTop: 1,
    '@media (prefers-color-scheme: dark)': {
      color: '#94a3b8',
    },
  },
  agentModelBadge: {
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.03em',
    color: '#6366f1',
    background: 'rgba(99, 102, 241, 0.1)',
    border: '1px solid rgba(99, 102, 241, 0.25)',
    borderRadius: '4px',
    padding: '1px 5px',
    display: 'inline-block',
    marginTop: 3,
    textTransform: 'uppercase',
    '@media (prefers-color-scheme: dark)': {
      color: '#a5b4fc',
      background: 'rgba(99, 102, 241, 0.15)',
    },
  },

  // Status pill
  statusPill: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: '0.72rem',
    fontWeight: 600,
    borderRadius: '20px',
    padding: '3px 10px',
    minWidth: 80,
    justifyContent: 'center',
    transition: 'background 0.3s ease, color 0.3s ease',
  },
  pillIdle: {
    background: '#f1f5f9',
    color: '#94a3b8',
    '@media (prefers-color-scheme: dark)': {
      background: '#334155',
      color: '#64748b',
    },
  },
  pillThinking: {
    background: '#dbeafe',
    color: '#1d4ed8',
    '@media (prefers-color-scheme: dark)': {
      background: '#1e3a5f',
      color: '#60a5fa',
    },
  },
  pillDone: {
    background: '#dcfce7',
    color: '#15803d',
    '@media (prefers-color-scheme: dark)': {
      background: '#14532d',
      color: '#4ade80',
    },
  },
  pillError: {
    background: '#fee2e2',
    color: '#b91c1c',
    '@media (prefers-color-scheme: dark)': {
      background: '#450a0a',
      color: '#f87171',
    },
  },

  // Shimmer progress bar
  progressTrack: {
    height: 3,
    borderRadius: 4,
    background: '#e2e8f0',
    overflow: 'hidden',
    marginTop: theme.spacing(0.75),
    '@media (prefers-color-scheme: dark)': {
      background: '#334155',
    },
  },
  '@keyframes shimmer': {
    '0%':   { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(200%)' },
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    background: 'linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #3b82f6 100%)',
    backgroundSize: '200% 100%',
    animation: '$shimmer 1.6s ease-in-out infinite',
  },
  progressDone: {
    height: '100%',
    borderRadius: 4,
    background: '#22c55e',
    width: '100%',
    transition: 'width 0.4s ease',
  },
  progressError: {
    height: '100%',
    borderRadius: 4,
    background: '#ef4444',
    width: '100%',
  },

  // ── Markdown results ────────────────────────────────────────────────────────
  markdownWrapper: {
    '& table': {
      width: '100%',
      borderCollapse: 'collapse',
      marginTop: theme.spacing(2),
      marginBottom: theme.spacing(2),
    },
    '& th, & td': {
      border: '1px solid #475569',
      padding: '12px',
      textAlign: 'left',
    },
    '& th': {
      backgroundColor: '#1e293b',
      fontWeight: 'bold',
      color: '#f1f5f9'
    },
    '& img': {
      maxWidth: '200px',
      height: 'auto',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
      marginTop: '8px',
      marginBottom: '8px'
    }
  }
}));

// ─── AgentProgressRow sub-component ──────────────────────────────────────────
function AgentProgressRow({ agent, status }) {
  const classes = useStyles();

  const rowClass = [
    classes.agentRow,
    status === STATUS.THINKING ? classes.agentRowThinking : '',
    status === STATUS.DONE     ? classes.agentRowDone     : '',
    status === STATUS.ERROR    ? classes.agentRowError    : '',
  ].filter(Boolean).join(' ');

  const pillClass = [
    classes.statusPill,
    status === STATUS.IDLE     ? classes.pillIdle     : '',
    status === STATUS.THINKING ? classes.pillThinking : '',
    status === STATUS.DONE     ? classes.pillDone     : '',
    status === STATUS.ERROR    ? classes.pillError    : '',
  ].filter(Boolean).join(' ');

  const pillContent = {
    [STATUS.IDLE]:     '· Waiting',
    [STATUS.THINKING]: '⟳ Working…',
    [STATUS.DONE]:     '✓ Done',
    [STATUS.ERROR]:    '✕ Failed',
  }[status] || '· Waiting';

  return (
    <div className={rowClass} role="status" aria-label={`${agent.label}: ${pillContent}`}>
      <div className={classes.agentIcon}>{agent.icon}</div>
      <div className={classes.agentMeta}>
        <div className={classes.agentLabel}>{agent.label}</div>
        <div className={classes.agentDesc}>{agent.description}</div>
        <div className={classes.agentModelBadge}>{agent.model}</div>
        {/* Progress bar */}
        <div className={classes.progressTrack}>
          {status === STATUS.THINKING && <div className={classes.progressFill} />}
          {status === STATUS.DONE     && <div className={classes.progressDone} />}
          {status === STATUS.ERROR    && <div className={classes.progressError} />}
        </div>
      </div>
      <div className={pillClass}>{pillContent}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
function RecommendationModal({ open, onClose, cdrProducts, bankUrls }) {
  const classes = useStyles();

  // Auth & form state
  const [passcode, setPasscode] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [income, setIncome] = useState('100000');
  const [monthlySpend, setMonthlySpend] = useState('2500');
  const [age, setAge] = useState('30');
  const [extraNeeds, setExtraNeeds] = useState('');

  // Orchestration state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  
  // Info tooltip modal state
  const [infoModalState, setInfoModalState] = useState({ open: false, content: '' });

  // Multi-agent progress: map of agentId → STATUS value
  const [agentStatus, setAgentStatus] = useState({
    pre: STATUS.IDLE,
    math: STATUS.IDLE,
    risk: STATUS.IDLE,
    synth: STATUS.IDLE,
  });

  // Tagline cycling state — only active during the parallel phase
  const [taglineIdx, setTaglineIdx] = useState(0);
  const [taglinePhase, setTaglinePhase] = useState('idle'); // 'idle' | 'parallel' | 'synth'
  const taglineTimer = useRef(null);

  // Start tagline cycling
  const startTaglineCycle = (phase) => {
    setTaglinePhase(phase);
    setTaglineIdx(0);
    if (taglineTimer.current) clearInterval(taglineTimer.current);
    taglineTimer.current = setInterval(() => {
      setTaglineIdx(prev => (prev + 1) % PARALLEL_TAGLINES.length);
    }, 3200);
  };

  const stopTaglines = () => {
    if (taglineTimer.current) clearInterval(taglineTimer.current);
    taglineTimer.current = null;
    setTaglinePhase('idle');
  };

  // Clean up interval on unmount
  useEffect(() => () => { if (taglineTimer.current) clearInterval(taglineTimer.current); }, []);

  const setAgent = (id, status) =>
    setAgentStatus(prev => ({ ...prev, [id]: status }));

  const resetAgentStatus = () =>
    setAgentStatus({ pre: STATUS.IDLE, math: STATUS.IDLE, risk: STATUS.IDLE, synth: STATUS.IDLE });

  // ── Auth ────────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-passcode': passcode },
        body: JSON.stringify({ action: 'verify' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to verify passcode.');
      setIsAuthenticated(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Analysis pipeline ────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    resetAgentStatus();

    try {
      const profile = {
        age: parseIntSafe(age, 28),
        income: parseIntSafe(income, 60000),
        monthlySpend: parseIntSafe(monthlySpend, 2500),
        primaryGoal,
        needs: extraNeeds,
      };
      const baseReq = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-passcode': passcode },
      };

      const fetchAgent = async (action, bodyData = {}) => {
        const res = await fetch(WORKER_URL, {
          ...baseReq,
          body: JSON.stringify({ action, profile, ...bodyData }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.details || data.error || `Failed on ${action}`);
        return data;
      };

      // Phase 1: Pre-Screener (Fetches all /products from bankUrls)
      setAgent('pre', STATUS.THINKING);
      startTaglineCycle('parallel');
      
      const prescreenData = await fetchAgent('run_prescreen', { bankUrls });
      const topProducts = prescreenData.topProducts;
      setAgent('pre', STATUS.DONE);

      // Phase 2: parallel agents (Worker fetches /products/{id} for top 5 and runs Math/Risk concurrently)
      setAgent('math', STATUS.THINKING);
      setAgent('risk', STATUS.THINKING);

      let mathAnalysis, riskAnalysis;
      try {
        const analysisData = await fetchAgent('run_analysis', { topProducts });
        mathAnalysis = analysisData.mathAnalysis;
        riskAnalysis = analysisData.riskAnalysis;
        setAgent('math', STATUS.DONE);
        setAgent('risk', STATUS.DONE);
      } catch (err) {
        setAgent('math', STATUS.ERROR);
        setAgent('risk', STATUS.ERROR);
        throw err;
      }

      // Phase 3: synthesizer
      stopTaglines();
      setTaglinePhase('synth');
      setAgent('synth', STATUS.THINKING);

      const synthData = await fetchAgent('run_synth', {
        mathAnalysis,
        riskAnalysis,
        topProducts,
      });

      setAgent('synth', STATUS.DONE);
      stopTaglines();
      
      try {
        const cleaned = synthData.recommendation.replace(/```json/gi, '').replace(/```/g, '').trim();
        setRecommendation(JSON.parse(cleaned));
      } catch (e) {
        throw new Error("Failed to parse AI recommendation. Please try again.");
      }
    } catch (err) {
      stopTaglines();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Delegated Click Handler for AI Tooltips ────────────────────────────────
  const handleMarkdownClick = (e) => {
    const btn = e.target.closest('.info-btn');
    if (btn) {
      const expl = btn.getAttribute('data-expl');
      setInfoModalState({ open: true, content: expl || 'No explanation provided.' });
    }
  };

  // ── Close / reset ────────────────────────────────────────────────────────────
  const handleClose = () => {
    stopTaglines();
    setPasscode('');
    setIsAuthenticated(false);
    setPrimaryGoal('');
    setIncome('100000');
    setMonthlySpend('2500');
    setAge('30');
    setExtraNeeds('');
    setRecommendation(null);
    setError(null);
    resetAgentStatus();
    onClose();
  };

  const hasNoCdrData = isAuthenticated && (!cdrProducts || cdrProducts.length === 0);

  // ── Derived display copy ─────────────────────────────────────────────────────
  const headlineCopy = (() => {
    if (taglinePhase === 'synth')    return 'Putting it all together — your results are almost ready.';
    if (taglinePhase === 'parallel') return PARALLEL_TAGLINES[taglineIdx];
    return '';
  })();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="recommender-dialog-title"
    >
      <DialogTitle id="recommender-dialog-title">AI Credit Card Recommendations</DialogTitle>
      <DialogContent className={classes.dialog}>

        {/* ASIC RG 244 Disclaimer */}
        <Paper className={classes.disclaimerBox} elevation={0}>
          <Typography className={classes.disclaimerTitle}>
            IMPORTANT: NOT FINANCIAL ADVICE
          </Typography>
          <Typography variant="body2">
            The information provided by this Multi-Agent AI system is general in nature and does not constitute personal financial product advice. It does not take into account your personal objectives, financial situation, or needs. Please consider the Product Disclosure Statement (PDS) and Target Market Determination (TMD) provided by the relevant financial institution before making a decision. (ASIC RG 244 Compliance)
          </Typography>
        </Paper>

        {!recommendation ? (
          <>
            {/* ── Pre-auth form ──────────────────────────────────────────── */}
            {!isAuthenticated && !loading && (
              <>
                <Typography variant="body1" gutterBottom>
                  Please enter the administrator passcode to activate the Multi-Agent AI pipeline.
                </Typography>
                <TextField
                  fullWidth
                  variant="outlined"
                  type="password"
                  label="Passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !loading && passcode && handleLogin()}
                  margin="normal"
                  autoComplete="current-password"
                  inputProps={{ 'aria-label': 'Passcode' }}
                />
              </>
            )}

            {/* ── Profile form (post-auth, pre-loading) ─────────────────── */}
            {isAuthenticated && !loading && (
              <>
                <Typography variant="body1" gutterBottom>
                  Tell us about yourself so our AI agents can find the right card for you.
                </Typography>

                {hasNoCdrData && (
                  <div className={classes.noCdrWarning} role="alert">
                    ⚠️ <strong>No product data loaded.</strong> Please go back to the <strong>Credit &amp; Charge Cards</strong> tab, load at least one Data Source, and re-open this panel. The AI agents require real CDR data to generate a recommendation.
                  </div>
                )}

                <TextField
                  select
                  fullWidth
                  variant="outlined"
                  label="What is your primary goal? *"
                  value={primaryGoal}
                  onChange={(e) => setPrimaryGoal(e.target.value)}
                  margin="normal"
                  SelectProps={{ native: true }}
                  InputLabelProps={{ shrink: true }}
                >
                  <option value="">— Select a goal —</option>
                  {GOAL_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </TextField>

                <Grid container spacing={1} style={{ marginTop: 4 }}>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth variant="outlined" label="Annual Income ($)"
                      type="number" value={income} onChange={(e) => setIncome(e.target.value)}
                      margin="normal" InputLabelProps={{ shrink: true }}
                      inputProps={{ min: 0, max: 99999999, 'aria-label': 'Annual Income in dollars' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth variant="outlined" label="Monthly Spend ($)"
                      type="number" value={monthlySpend} onChange={(e) => setMonthlySpend(e.target.value)}
                      margin="normal" InputLabelProps={{ shrink: true }}
                      inputProps={{ min: 0, max: 999999, 'aria-label': 'Monthly Spend in dollars' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth variant="outlined" label="Age"
                      type="number" value={age} onChange={(e) => setAge(e.target.value)}
                      margin="normal" InputLabelProps={{ shrink: true }}
                      inputProps={{ min: 18, max: 120, 'aria-label': 'Your age' }}
                    />
                  </Grid>
                </Grid>

                <TextField
                  fullWidth variant="outlined" multiline rows={2}
                  label="Anything else? (Optional — e.g. I travel to Japan twice a year)"
                  value={extraNeeds} onChange={(e) => setExtraNeeds(e.target.value)}
                  margin="normal" InputLabelProps={{ shrink: true }}
                  inputProps={{ maxLength: 500, 'aria-label': 'Additional context for the recommendation' }}
                  helperText={extraNeeds.length > 400 ? `${500 - extraNeeds.length} characters remaining` : undefined}
                />

                {cdrProducts && cdrProducts.length > 0 && (
                  <Typography variant="caption" style={{ color: '#64748b', display: 'block', marginTop: 4 }}>
                    ✓ {cdrProducts.length} real CDR product{cdrProducts.length !== 1 ? 's' : ''} loaded and ready for analysis.
                  </Typography>
                )}
              </>
            )}

            {/* ── Multi-agent loading panel ──────────────────────────────── */}
            {loading && (
              <div className={classes.loadingRoot} role="status" aria-live="polite">
                {/* Cycling tagline headline */}
                <div className={classes.loadingHeadline} aria-live="polite">
                  {isAuthenticated ? headlineCopy : 'Verifying your access…'}
                </div>

                {/* Only show agent rows during the analysis phase */}
                {isAuthenticated && (
                  <>
                    <div className={classes.loadingSubline}>
                      Your analysis is being handled by three specialist AI agents working in parallel
                    </div>
                    {AGENT_DEFINITIONS.map(agent => (
                      <AgentProgressRow
                        key={agent.id}
                        agent={agent}
                        status={agentStatus[agent.id]}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Error message */}
            {error && (
              <Typography color="error" variant="body2" role="alert" style={{ marginTop: 8 }}>
                {error}
              </Typography>
            )}
          </>
        ) : (
          /* ── Results ─────────────────────────────────────────────────────── */
          <>
            <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #e2e8f0' }}>
              <Typography variant="subtitle2" style={{ color: '#0f172a' }}>
                <strong>AI Recommendations for:</strong> {recommendation.goalSummary || "Your profile"}
              </Typography>
            </div>

            {recommendation.verificationChecklist && recommendation.verificationChecklist.length > 0 && (
              <div className="checklist-box">
                <h4>✅ Verification Required Checklist</h4>
                <ul>
                  {recommendation.verificationChecklist.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}

            <div className="recommender-grid">
              {recommendation.cards && recommendation.cards.map((card, idx) => (
                <div key={idx} className="product-card">
                  {card.image ? (
                    <img src={card.image.replace(/https:\/\/shauncb\.github\.io\/OpenCard-AU\/images\//g, import.meta.env.BASE_URL + 'images/')} alt={card.name} className="product-card-image" />
                  ) : (
                    <div className="product-card-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>No Image</div>
                  )}
                  
                  <div className="product-card-header">
                    <h3 className="product-card-title">{card.name}</h3>
                    <p className="product-card-brand">{card.brand}</p>
                  </div>

                  <div className="metric-row">
                    <span className="metric-label">Eligibility Status</span>
                    <span className="metric-value">{card.eligibility}</span>
                  </div>
                  
                  <div className="metric-row">
                    <span className="metric-label">Annual Fee</span>
                    <span className="metric-value">{card.annualFee}</span>
                  </div>

                  {card.estAnnualInterest ? (
                    <div className="metric-row">
                      <span className="metric-label">Est. Annual Interest</span>
                      <span className="metric-value">
                        <button type="button" className="info-btn" onClick={(e) => { e.preventDefault(); setInfoModalState({ open: true, content: card.estAnnualInterest?.explanation }); }}>
                          {card.estAnnualInterest?.display} ⓘ
                        </button>
                      </span>
                    </div>
                  ) : card.avoidableFees ? (
                    <div className="metric-row">
                      <span className="metric-label">Avoidable Fees</span>
                      <span className="metric-value">
                        <button type="button" className="info-btn" onClick={(e) => { e.preventDefault(); setInfoModalState({ open: true, content: card.avoidableFees?.explanation }); }}>
                          {card.avoidableFees?.display} ⓘ
                        </button>
                      </span>
                    </div>
                  ) : null}

                  <div className="metric-row">
                    <span className="metric-label">Est. Reward Value</span>
                    <span className="metric-value">
                      <button type="button" className="info-btn" onClick={(e) => { e.preventDefault(); setInfoModalState({ open: true, content: card.estRewardValue?.explanation }); }}>
                        {card.estRewardValue?.display} ⓘ
                      </button>
                    </span>
                  </div>

                  <div className="metric-row">
                    <span className="metric-label">Est. Net Annual Cost</span>
                    <span className={`metric-value ${(card.estNetAnnualCost && card.estNetAnnualCost.numValue < 0) ? 'green' : ''}`}>
                      <button type="button" className="info-btn" onClick={(e) => { e.preventDefault(); setInfoModalState({ open: true, content: card.estNetAnnualCost?.explanation }); }}>
                        {card.estNetAnnualCost?.display} ⓘ
                      </button>
                    </span>
                  </div>

                  <div className="metric-row" style={{ flexDirection: 'column', borderBottom: 'none' }}>
                    <span className="metric-label" style={{ paddingBottom: '4px' }}>Key Risks</span>
                    <ul className="key-risks-list">
                      {card.keyRisks && card.keyRisks.map((risk, i) => <li key={i}>🔺 {risk}</li>)}
                    </ul>
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                    <Button 
                      variant={idx < 2 ? "contained" : "outlined"} 
                      color="primary" 
                      fullWidth 
                      href={card.applicationUri || '#'} 
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {idx < 2 ? "Apply Now" : "More Info"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {recommendation.topPickReason && (
              <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
                <Typography variant="subtitle1" style={{ color: '#92400e', fontWeight: 'bold' }}>🏆 Top Pick:</Typography>
                <Typography variant="body2" style={{ color: '#92400e' }}>{recommendation.topPickReason}</Typography>
              </div>
            )}

            {recommendation.dataGaps && recommendation.dataGaps.length > 0 && (
              <div style={{ marginTop: '16px', padding: '12px', borderLeft: '4px solid #f59e0b', backgroundColor: '#fffbeb' }}>
                <Typography variant="subtitle2" style={{ color: '#b45309' }}>⚠️ Data Gaps</Typography>
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#b45309', fontSize: '0.85rem' }}>
                  {recommendation.dataGaps.map((gap, i) => <li key={i}>{gap}</li>)}
                </ul>
              </div>
            )}

            <Typography variant="caption" style={{ color: '#64748b', display: 'block', marginTop: 16, textAlign: 'center' }}>
              <em>* Estimations based on user-provided monthly spend and flying preference.</em>
            </Typography>
          </>
        )}

        {/* Mobile-Friendly Tooltip Modal */}
        <Dialog 
          open={infoModalState.open} 
          onClose={() => setInfoModalState({ ...infoModalState, open: false })} 
          maxWidth="xs" 
          fullWidth
          aria-labelledby="tooltip-dialog-title"
        >
          <DialogTitle id="tooltip-dialog-title">Calculation Breakdown</DialogTitle>
          <DialogContent>
            <Typography variant="body1">{infoModalState.content}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setInfoModalState({ ...infoModalState, open: false })} color="primary" variant="contained">
              Close
            </Button>
          </DialogActions>
        </Dialog>

      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} color="primary">
          {recommendation ? 'Close' : 'Cancel'}
        </Button>
        {recommendation && (
          <Button onClick={() => { setRecommendation(null); resetAgentStatus(); }} color="primary">
            ← Run Again
          </Button>
        )}
        {!recommendation && !isAuthenticated && (
          <Button onClick={handleLogin} color="primary" variant="contained" disabled={loading || !passcode}>
            Login
          </Button>
        )}
        {!recommendation && isAuthenticated && (
          <Button
            onClick={handleAnalyze}
            color="primary"
            variant="contained"
            disabled={loading || !primaryGoal || hasNoCdrData}
          >
            {loading ? 'Analysing…' : 'Analyze'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ─── URL resolution (unchanged) ───────────────────────────────────────────────
function resolveCardArtUri(imageUri, dataSourceUrl) {
  if (!imageUri) return null;
  let resolved = imageUri.trim();
  if (resolved.startsWith('/') && dataSourceUrl) {
    try { resolved = new URL(dataSourceUrl).origin + resolved; } catch (e) { /* ignore */ }
  }
  if (resolved.includes('openbank.api.nab.com.au') || resolved.includes('api.nab.com.au')) {
    resolved = resolved.replace(/openbank\.api\.nab\.com\.au|api\.nab\.com\.au/, 'www.nab.com.au');
  }
  if (resolved.startsWith('http://')) resolved = 'https://' + resolved.substring(7);
  if (/^(javascript|vbscript|data):/i.test(resolved)) return null;
  return resolved;
}

// ─── Redux ────────────────────────────────────────────────────────────────────
const mapStateToProps = (state) => {
  const allProductDetails = [];
  const MAX_PRODUCTS = 75;
  if (state.banking && Array.isArray(state.banking)) {
    for (let idx = 0; idx < state.banking.length; idx++) {
      if (allProductDetails.length >= MAX_PRODUCTS) break;
      const bankingSource = state.banking[idx];
      if (!bankingSource || !Array.isArray(bankingSource.productDetails)) continue;
      const dataSourceUrl = state.dataSources?.[idx]?.url ?? null;
      for (const detail of bankingSource.productDetails) {
        if (allProductDetails.length >= MAX_PRODUCTS) break;
        if (!detail?.productId) continue;
        const resolvedDetail = { ...detail };
        if (Array.isArray(detail.cardArt)) {
          resolvedDetail.cardArt = detail.cardArt.map(art => ({
            ...art,
            imageUri: resolveCardArtUri(art.imageUri, dataSourceUrl),
          }));
        }
        allProductDetails.push(resolvedDetail);
      }
    }
  }
  const bankUrls = (state.dataSources || []).map(src => src.url).filter(Boolean);
  return { cdrProducts: allProductDetails, bankUrls };
};

export default connect(mapStateToProps)(RecommendationModal);
