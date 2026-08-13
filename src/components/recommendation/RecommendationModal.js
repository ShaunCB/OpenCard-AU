import React, { useState, useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import { 
  Dialog, DialogTitle, DialogContent, DialogActions, 
  Button, TextField, Typography, 
  makeStyles, Paper, Grid, MenuItem
} from '@material-ui/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// ─── Module-level constants (not recreated on every render) ──────────────────
const WORKER_URL = 'https://cdr-recommender.mr-shaun.workers.dev';

const GOAL_OPTIONS = [
  'General Reward Points (Flexible bank points)',
  'Frequent Flyer / Airline Miles',
  'Cashback',
  'Premium Travel Perks (Lounge access, travel credit)',
  '0% Intro APR / Balance Transfer',
];

const CATEGORY_OPTIONS = [
  'Groceries',
  'Dining/Takeout',
  'Travel',
  'Gas/Transit',
  'Online Shopping',
  'General/Other'
];

// Consumer-friendly taglines that cycle during the parallel analysis phase.
// Designed to reassure without exposing internal technical detail.
const PARALLEL_TAGLINES = [
  'Crunching the numbers on fees, rates & rewards…',
  'Checking your eligibility across all available cards…',
  'Weighing up what matters most for your goal…',
  'Almost there — comparing the fine print so you don\'t have to…',
];

const AGENT_DEFINITIONS = [
  {
    id: 'analysis',
    action: 'run_single_analysis',
    label: 'AI Architect',
    description: 'Pre-screening, calculating value, and synthesising recommendation...',
    model: 'LLAMA 3.3 70B INSTRUCT (131K CONTEXT)',
    icon: '🤖',
  }
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
  },
  errorRoot: {
    padding: theme.spacing(3),
    backgroundColor: '#fef2f2',
    border: '1px solid #f87171',
    borderRadius: '8px',
    marginTop: theme.spacing(2),
    '@media (prefers-color-scheme: dark)': {
      backgroundColor: '#450a0a',
      borderColor: '#b91c1c',
    }
  },
  errorBlock: {
    backgroundColor: '#1e293b',
    color: '#f1f5f9',
    padding: theme.spacing(1.5),
    borderRadius: '4px',
    overflowX: 'auto',
    fontSize: '0.8rem',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  cuttingRoomRoot: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: '#f1f5f9',
    borderRadius: '8px',
    '@media (prefers-color-scheme: dark)': {
      backgroundColor: 'rgba(30, 41, 59, 0.9)',
      color: '#f8fafc',
    },
  },
  cuttingRoomText: {
    marginBottom: '12px',
    color: '#475569',
    '@media (prefers-color-scheme: dark)': {
      color: '#cbd5e1',
    },
  },
  reasoningBox: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#fff',
    borderRadius: '4px',
    border: '1px solid #cbd5e1',
    '@media (prefers-color-scheme: dark)': {
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      color: '#f8fafc',
    },
  },
  decisionMatrixRoot: {
    marginTop: '12px',
    padding: '8px',
    backgroundColor: '#f8fafc',
    borderRadius: '4px',
    fontSize: '0.85rem',
    '@media (prefers-color-scheme: dark)': {
      backgroundColor: 'rgba(30, 41, 59, 0.9)',
      color: '#e2e8f0',
    },
  },
  decisionMatrixSummary: {
    cursor: 'pointer',
    fontWeight: 'bold',
    color: '#334155',
    '@media (prefers-color-scheme: dark)': {
      color: '#f8fafc',
    },
  },
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
  const [payInFull, setPayInFull] = useState('');
  const [topCategories, setTopCategories] = useState([]);
  const [income, setIncome] = useState('100000');
  const [monthlySpend, setMonthlySpend] = useState('5000');
  const [age, setAge] = useState('30');
  const [extraNeeds, setExtraNeeds] = useState('');

  // Orchestration state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  
  const [infoModalState, setInfoModalState] = useState({ open: false, content: '' });

  // Cutting Room Floor state
  const [excludedCardId, setExcludedCardId] = useState('');
  const [exclusionReasoning, setExclusionReasoning] = useState(null);
  const [exclusionLoading, setExclusionLoading] = useState(false);

  // Multi-agent progress: map of agentId → STATUS value
  const [agentStatus, setAgentStatus] = useState({
    analysis: STATUS.IDLE,
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
    setAgentStatus({ analysis: STATUS.IDLE });

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
      console.error('[Credit Card Recommender Debug]: Auth Error', err);
      setError({
        name: err.name,
        message: err.message,
        stack: err.stack
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAgent = async (action, bodyData = {}) => {
    const profile = { 
      primaryGoal, 
      payInFull, 
      topCategories, 
      income: parseIntSafe(income, 100000),
      monthlySpend: parseIntSafe(monthlySpend, 5000),
      age: parseIntSafe(age, 30),
      needs: extraNeeds 
    };
    const baseReq = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-passcode': passcode },
    };
    
    const MAX_RETRIES = 2;
    let attempt = 0;
    
    while (attempt <= MAX_RETRIES) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        
        const res = await fetch(WORKER_URL, {
          ...baseReq,
          body: JSON.stringify({ action, profile, ...bodyData }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const textPayload = await res.text();
        let data;
        try {
          data = JSON.parse(textPayload);
        } catch (parseErr) {
          console.error('[Credit Card Recommender Debug]: JSON Parse Error', parseErr);
          const e = new Error('Invalid JSON response from server');
          e.status = res.status;
          e.payload = textPayload;
          e.stack = parseErr.stack;
          throw e;
        }
        
        if (!res.ok) {
          const err = new Error(data.details || data.error || `Failed on ${action}`);
          err.status = res.status;
          err.payload = textPayload;
          console.error('[Credit Card Recommender Debug]: API Error', err);
          throw err;
        }
        return data;
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error(`[Credit Card Recommender Debug]: Request timeout on ${action} (attempt ${attempt + 1})`);
        } else {
          console.error(`[Credit Card Recommender Debug]: Network/CORS Error on ${action} (attempt ${attempt + 1})`, err);
        }
        
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Connection to AI server dropped or timed out after ${MAX_RETRIES + 1} attempts. Please try again.`);
        }
        
        attempt++;
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
  };

  // ── Analysis pipeline ────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!primaryGoal || !payInFull) {
      setError({ name: 'Validation', message: 'Please complete all required fields.' });
      return;
    }
    setLoading(true);
    setError(null);
    resetAgentStatus();

    try {

      setAgent('analysis', STATUS.THINKING);
      
      let finalCdrData = minifyCdrData(cdrProducts);
      
      if (!finalCdrData || finalCdrData.length === 0) {
        const err = new Error("No eligible credit cards were found in the provided data sources. Please try adding different banks.");
        err.name = "DataValidationError";
        throw err;
      }
      
      const synthData = await fetchAgent('run_single_analysis', { cdrProducts: finalCdrData });
      setAgent('analysis', STATUS.DONE);
      
      try {
        let cleaned = synthData.recommendation;
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        } else {
          cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();
        }
        setRecommendation(JSON.parse(cleaned));
      } catch (e) {
        console.error('[Credit Card Recommender Debug]: JSON Parse Recommendation Error', e);
        throw new Error("Failed to parse AI recommendation. Please try again.");
      }
    } catch (err) {
      console.error('[Credit Card Recommender Debug]: Pipeline Error', err);
      stopTaglines();
      setError({
        name: err.name,
        message: err.message,
        status: err.status,
        payload: err.payload,
        stack: err.stack
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAssessExclusion = async (cardId) => {
    setExcludedCardId(cardId);
    setExclusionReasoning(null);
    if (!cardId) return;
    
    setExclusionLoading(true);
    try {
      // We pass the raw cdrProduct detail directly to avoid worker re-fetching
      const targetCard = cdrProducts.find(c => c.productId === cardId);
      
      const res = await fetchAgent('run_exclusion_reasoning', { 
        cardId, 
        targetCard,
      });
      setExclusionReasoning(res.reasoning);
    } catch (err) {
      setExclusionReasoning("Failed to fetch exclusion reasoning: " + err.message);
    } finally {
      setExclusionLoading(false);
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
    setPayInFull('');
    setTopCategories([]);
    setIncome('100000');
    setMonthlySpend('5000');
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
        {!isAuthenticated && (
          <Paper className={classes.disclaimerBox} elevation={0}>
            <Typography className={classes.disclaimerTitle}>
              IMPORTANT: NOT FINANCIAL ADVICE
            </Typography>
            <Typography variant="body2">
              The information provided by this AI system is general in nature and does not constitute personal financial product advice. It does not take into account your personal objectives, financial situation, or needs. Please consider the Product Disclosure Statement (PDS) and Target Market Determination (TMD) provided by the relevant financial institution before making a decision. (ASIC RG 244 Compliance)
            </Typography>
          </Paper>
        )}

        {!recommendation ? (
          <>
            {/* ── Pre-auth form ──────────────────────────────────────────── */}
            {!isAuthenticated && !loading && (
              <>
                <Typography variant="body1" gutterBottom>
                  Please enter the administrator passcode to activate the AI pipeline.
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
            {isAuthenticated && !loading && !error && (
              <>
                <Typography variant="body1" gutterBottom>
                  Tell us about yourself so our AI Architect can find the right card for you.
                </Typography>

                {hasNoCdrData && (
                  <div className={classes.noCdrWarning} role="alert">
                    ⚠️ <strong>No product data loaded.</strong> Please go back to the <strong>Credit &amp; Charge Cards</strong> tab, load at least one Data Source, and re-open this panel. The AI requires real CDR data to generate a recommendation.
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
                  InputLabelProps={{ shrink: true }}
                >
                  <MenuItem value="">
                    <em>— Select a goal —</em>
                  </MenuItem>
                  {GOAL_OPTIONS.map(opt => (
                    <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                  ))}
                </TextField>
                
                <TextField
                  select
                  fullWidth
                  variant="outlined"
                  label="Do you typically pay your balance in full every month? *"
                  value={payInFull}
                  onChange={(e) => setPayInFull(e.target.value)}
                  margin="normal"
                  InputLabelProps={{ shrink: true }}
                >
                  <MenuItem value=""><em>— Select —</em></MenuItem>
                  <MenuItem value="Yes">Yes, I pay it in full</MenuItem>
                  <MenuItem value="No, I carry a balance">No, I carry a balance</MenuItem>
                </TextField>

                <div style={{ margin: '16px 0' }}>
                  <Typography variant="body2" color="textSecondary" style={{ marginBottom: 8 }}>
                    What are your top two monthly spending categories? (Max 2)
                  </Typography>
                  <Grid container spacing={1}>
                    {CATEGORY_OPTIONS.map(opt => {
                      const isChecked = topCategories.includes(opt);
                      const isDisabled = !isChecked && topCategories.length >= 2;
                      return (
                        <Grid item xs={6} sm={4} key={opt}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.5 : 1, fontSize: '0.9rem' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isDisabled}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  if (topCategories.length < 2) setTopCategories([...topCategories, opt]);
                                } else {
                                  setTopCategories(topCategories.filter(item => item !== opt));
                                }
                              }}
                              style={{ marginRight: 8 }}
                            />
                            {opt}
                          </label>
                        </Grid>
                      );
                    })}
                  </Grid>
                </div>

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
                    <Typography variant="body2" className={classes.loadingSubline} style={{ marginBottom: 16 }}>
                      Your analysis is being handled by our AI Architect.
                    </Typography>
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
              <div className={classes.errorRoot} role="alert">
                <Typography variant="h6" color="error" style={{ marginBottom: 8 }}>
                  Analysis Failed
                </Typography>
                <Typography variant="body1">
                  <strong>Error:</strong> {error.name}: {error.message}
                </Typography>
                {error.status && (
                  <Typography variant="body2">
                    <strong>HTTP Status:</strong> {error.status}
                  </Typography>
                )}
                {error.payload && (
                  <>
                    <Typography variant="body2" style={{ marginTop: 12 }}>
                      <strong>Raw Response:</strong>
                    </Typography>
                    <pre className={classes.errorBlock}>{error.payload}</pre>
                  </>
                )}
                {error.stack && (
                  <>
                    <Typography variant="body2" style={{ marginTop: 12 }}>
                      <strong>Stack Trace:</strong>
                    </Typography>
                    <pre className={classes.errorBlock}>{error.stack}</pre>
                  </>
                )}
                <div style={{ marginTop: 16 }}>
                  <Button 
                    onClick={() => { setError(null); handleAnalyze(); }} 
                    variant="contained" 
                    color="primary" 
                    style={{ marginRight: 8 }}
                  >
                    Try Again
                  </Button>
                  <Button 
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(error, null, 2))} 
                    variant="outlined"
                    style={{ marginRight: 8 }}
                  >
                    Copy Error Details
                  </Button>
                  <Button 
                    onClick={() => { setError(null); resetAgentStatus(); }} 
                    variant="text"
                  >
                    Go Back
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── Results ─────────────────────────────────────────────────────── */
          <>
            <div className="goal-summary-box">
              <Typography variant="subtitle2">
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
                    <img
                      src={card.image}
                      alt={card.name}
                      className="product-card-image"
                      style={{ objectFit: 'contain', padding: '8px' }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className="product-card-image"
                    style={{
                      display: card.image ? 'none' : 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      fontSize: '0.85rem'
                    }}
                  >
                    No Image
                  </div>
                  
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

                  {card.decisionMatrix && (
                    <div className={classes.decisionMatrixRoot}>
                      <details>
                        <summary className={classes.decisionMatrixSummary}>🧠 AI Decision Matrix</summary>
                        <div style={{ marginTop: '8px' }}>
                          <strong>Inclusion Steps:</strong>
                          <ul style={{ paddingLeft: '16px', margin: '4px 0' }}>
                            {card.decisionMatrix.inclusionSteps && card.decisionMatrix.inclusionSteps.map((step, i) => <li key={i}>{step}</li>)}
                          </ul>
                          <div style={{ marginTop: '8px' }}>
                            <strong>The Decisive Factor:</strong> {card.decisionMatrix.decisiveFactor}
                          </div>
                        </div>
                      </details>
                    </div>
                  )}

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
              <div className="top-pick-box">
                <Typography variant="subtitle1" style={{ fontWeight: 'bold' }}>🏆 Top Pick:</Typography>
                <Typography variant="body2">{recommendation.topPickReason}</Typography>
              </div>
            )}

            {recommendation.dataGaps && recommendation.dataGaps.length > 0 && (
              <div className="data-gaps-box">
                <Typography variant="subtitle2">⚠️ Data Gaps</Typography>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                  {recommendation.dataGaps.map((gap, i) => <li key={i}>{gap}</li>)}
                </ul>
              </div>
            )}

            <div className={classes.cuttingRoomRoot}>
              <Typography variant="subtitle1" style={{ fontWeight: 'bold' }}>✂️ The Cutting Room Floor</Typography>
              <Typography variant="body2" className={classes.cuttingRoomText}>
                In-Scope Cards Not Recommended. Select a card to see exactly why the AI excluded it based on your profile.
              </Typography>
              
              {recommendation.excludedMajorCards && recommendation.excludedMajorCards.length > 0 && (
                <div className={classes.reasoningBox} style={{ marginBottom: '16px' }}>
                  <Typography variant="subtitle2" style={{ fontWeight: 'bold', marginBottom: '8px' }}>Excluded Major Bank Cards:</Typography>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                    {recommendation.excludedMajorCards.map((mc, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        <strong>{mc.cardName} ({mc.brand})</strong>: {mc.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <TextField
                select
                fullWidth
                variant="outlined"
                label="Select an excluded card"
                value={excludedCardId}
                onChange={(e) => handleAssessExclusion(e.target.value)}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value=""><em>— Select a card —</em></MenuItem>
                {cdrProducts && cdrProducts
                  .filter(p => !recommendation.cards.find(c => c.name === p.name))
                  .map(p => (
                    <MenuItem key={p.productId} value={p.productId}>{p.name} ({p.brand})</MenuItem>
                  ))}
              </TextField>
              
              {exclusionLoading && (
                <div style={{ marginTop: '12px', color: '#64748b' }}>Assessing reasoning...</div>
              )}
              
              {exclusionReasoning && !exclusionLoading && (
                <div className={classes.reasoningBox}>
                  <Typography variant="body2"><strong>AI Assessment:</strong> {exclusionReasoning}</Typography>
                </div>
              )}
            </div>

            <Typography variant="caption" style={{ color: '#64748b', display: 'block', marginTop: 16, textAlign: 'center' }}>
              <em>* Estimations are based on the user-provided financial profile and publicly available CDR product data.</em>
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

// ─── Data Minification ────────────────────────────────────────────────────────
function minifyCdrData(prdArray) {
  if (!Array.isArray(prdArray)) return [];
  const CARD_CATEGORIES = ['CRED_AND_CHRG_CARDS', 'BUSINESS_CARDS', 'CORPORATE_CARDS'];
  const cardProducts = prdArray.filter(p => p && CARD_CATEGORIES.includes(p.productCategory));

  return cardProducts.map(product => {
    const cardArtEntry = Array.isArray(product.cardArt) ? product.cardArt.find(a => a && a.imageUri) : null;
    const minified = {
      id: product.productId,
      name: product.name,
      brand: product.brand || product.brandName,
      isTailored: product.isTailored,
      image: cardArtEntry ? cardArtEntry.imageUri : null,
      applicationUri: product.applicationUri || null,
      _bankUrl: product._bankUrl,
      features: [],
      fees: [],
      rates: [],
      eligibility: []
    };

    if (product.features) {
      minified.features = product.features
        .filter(f => f && f.featureType !== 'OTHER' && f.featureType !== 'DIGITAL_BANKING')
        .map(f => ({ type: f.featureType, info: f.additionalInfo }));
    }
    if (product.fees) {
      minified.fees = product.fees.filter(f => f).map(f => ({
        type: f.feeType,
        amount: f.amount != null ? f.amount : (f.fixedAmount?.amount ?? null),
        name: f.name
      }));
    }
    if (product.lendingRates) {
      minified.rates = product.lendingRates.filter(r => r).map(r => ({
        type: r.lendingRateType,
        rate: r.rate,
        name: r.name
      }));
    }
    if (product.eligibility) {
      minified.eligibility = product.eligibility.filter(e => e).map(e => ({
        type: e.eligibilityType,
        info: e.additionalInfo,
        value: e.additionalValue
      }));
    }

    Object.keys(minified).forEach(key => {
      if (Array.isArray(minified[key]) && minified[key].length === 0) delete minified[key];
      if (minified[key] === null || minified[key] === undefined) delete minified[key];
    });

    return minified;
  });
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
  const bankUrls = (state.dataSources || [])
    .filter(src => src.url && !src.deleted && (src.sectors?.includes('banking') || src.sectors?.includes('non-bank-lending') || !src.sectors))
    .map(src => src.url)
    .filter(Boolean);
  return { cdrProducts: allProductDetails, bankUrls };
};

export default connect(mapStateToProps)(RecommendationModal);
