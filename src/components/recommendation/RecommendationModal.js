import React, { useState } from 'react';
import { 
  Dialog, DialogTitle, DialogContent, DialogActions, 
  Button, TextField, CircularProgress, Typography, 
  makeStyles, Paper 
} from '@material-ui/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

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
    borderRadius: '4px'
  },
  disclaimerTitle: {
    fontWeight: 'bold',
    marginBottom: theme.spacing(1),
  },
  markdownContent: {
    '& h3': { marginTop: theme.spacing(3), marginBottom: theme.spacing(1) },
    '& h4': { marginTop: theme.spacing(2), marginBottom: theme.spacing(1) },
    '& p': { marginBottom: theme.spacing(2) },
    '& ul': { marginBottom: theme.spacing(2), paddingLeft: theme.spacing(3) },
    '& li': { marginBottom: theme.spacing(1) },
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing(4),
  },
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

function RecommendationModal({ open, onClose }) {
  const classes = useStyles();
  const [passcode, setPasscode] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Structured profile fields
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [income, setIncome] = useState('60000');
  const [monthlySpend, setMonthlySpend] = useState('2500');
  const [age, setAge] = useState('28');
  const [extraNeeds, setExtraNeeds] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  
  const GOAL_OPTIONS = [
    'Low Interest Rate',
    'Rewards & Points (Frequent Flyer)',
    'No Annual Fee',
    'Travel Benefits & Insurance',
    'Balance Transfer',
    'Cashback',
    'No Foreign Transaction Fees',
  ];
  
  // Set this to your deployed Cloudflare Worker URL
  const WORKER_URL = 'https://cdr-recommender.mr-shaun.workers.dev';
  
  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-passcode': passcode
        },
        body: JSON.stringify({ action: 'verify' })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify passcode.');
      }

      setIsAuthenticated(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    setLoadingMessage('Initializing agents...');
    
    try {
      const profile = { 
        age: parseInt(age) || 28, 
        income: parseInt(income) || 60000, 
        monthlySpend: parseInt(monthlySpend) || 2500, 
        primaryGoal,
        needs: extraNeeds 
      };
      const baseReq = { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-passcode': passcode } };

      // Helper for making worker requests
      const fetchAgent = async (action, bodyData = {}) => {
        const res = await fetch(WORKER_URL, { ...baseReq, body: JSON.stringify({ action, profile, ...bodyData }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.details || data.error || `Failed on ${action}`);
        return data;
      };

      setLoadingMessage('Agents running in parallel (Math & Risk)...');
      
      const mathPromise = fetchAgent('run_math');
      const riskPromise = fetchAgent('run_risk');

      const [mathData, riskData] = await Promise.all([mathPromise, riskPromise]);

      setLoadingMessage('Synthesizing final recommendation...');
      
      const synthData = await fetchAgent('run_synth', { 
        mathAnalysis: mathData.result, 
        riskAnalysis: riskData.result,
        userProfile: profile,
      });

      setRecommendation(synthData.recommendation);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleClose = () => {
    setPasscode('');
    setIsAuthenticated(false);
    setPrimaryGoal('');
    setIncome('60000');
    setMonthlySpend('2500');
    setAge('28');
    setExtraNeeds('');
    setRecommendation(null);
    setError(null);
    onClose();
  };

  const createMarkup = (markdownText) => {
    const html = marked(markdownText);
    return { __html: DOMPurify.sanitize(html) };
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>AI Credit Card Recommendations</DialogTitle>
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
            {!isAuthenticated ? (
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
                  margin="normal"
                />
              </>
            ) : (
              <>
                <Typography variant="body1" gutterBottom>
                  Tell us about yourself so our AI agents can give you a precise, personalised recommendation.
                </Typography>

                {/* Primary Goal Dropdown */}
                <TextField
                  select
                  fullWidth
                  variant="outlined"
                  label="What is your primary goal? *"
                  value={primaryGoal}
                  onChange={(e) => setPrimaryGoal(e.target.value)}
                  margin="normal"
                  SelectProps={{ native: true }}
                >
                  <option value="">— Select a goal —</option>
                  {GOAL_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </TextField>

                {/* Financial Profile Row */}
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Annual Income ($)"
                    type="number"
                    value={income}
                    onChange={(e) => setIncome(e.target.value)}
                    margin="normal"
                  />
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Monthly Spend ($)"
                    type="number"
                    value={monthlySpend}
                    onChange={(e) => setMonthlySpend(e.target.value)}
                    margin="normal"
                  />
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Age"
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    margin="normal"
                  />
                </div>

                {/* Optional extras */}
                <TextField
                  fullWidth
                  variant="outlined"
                  multiline
                  rows={2}
                  label="Anything else? (Optional — e.g. I travel to Japan twice a year)"
                  value={extraNeeds}
                  onChange={(e) => setExtraNeeds(e.target.value)}
                  margin="normal"
                />
              </>
            )}

            {error && (
              <Typography color="error" variant="body2" style={{ marginTop: 8 }}>
                {error}
              </Typography>
            )}
            
            {loading && (
              <div className={classes.loadingContainer}>
                <CircularProgress />
                <Typography variant="body2" style={{ marginTop: 16 }}>
                  {isAuthenticated ? loadingMessage : 'Verifying passcode...'}
                </Typography>
              </div>
            )}
          </>
        ) : (
          <div 
            className={classes.markdownWrapper} 
            dangerouslySetInnerHTML={{ 
              __html: DOMPurify.sanitize(
                marked(recommendation.replace(/https:\/\/shauncb\.github\.io\/OpenCard-AU\/images\//g, import.meta.env.BASE_URL + 'images/'))
              ) 
            }} 
          />
        )}

      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="primary">
          {recommendation ? 'Close' : 'Cancel'}
        </Button>
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
            disabled={loading || !primaryGoal}
          >
            Analyze
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default RecommendationModal;
