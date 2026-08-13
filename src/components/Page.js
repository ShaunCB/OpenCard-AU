import React from 'react'
import DataSourcePanel from './data-source/DataSourcePanel'
import BankingPanel from './data/banking/BankingPanel'
import ConsolePanel from './data/ConsolePanel'
import Header from './header'
import { Container, Button } from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'
import BankingComparisonPanel from './comparison/BankingComparisonPanel'
import AppBar from '@material-ui/core/AppBar'
import Tabs from '@material-ui/core/Tabs'
import Tab from '@material-ui/core/Tab'
import DiscoveryInfo from './data/discovery/DiscoveryInfo'
import RecommendationModal from './recommendation/RecommendationModal'

const useStyles = makeStyles(theme => ({
  hidden: {
    display: 'none'
  }
}))
  
function Page() {
  const [value, setValue] = React.useState(0)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [clickCount, setClickCount] = React.useState(0)
  const classes = useStyles()

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  const handleSecretClick = () => {
    const newCount = clickCount + 1;
    setClickCount(newCount);
    if (newCount >= 3) {
      setModalOpen(true);
      setClickCount(0);
    }
  };
  
  return (
    <Container maxWidth={false}>
      <Header title='Card Comparator Prime'/>
      <AppBar position="static" style={{marginTop: 8, marginBottom: 8}}>
        <Tabs value={value} onChange={handleChange}>
          <Tab label="Credit & Charge Cards" />
          <Tab label="Status and Outages" />
        </Tabs>
      </AppBar>
      <div className={value === 0 ? '' : classes.hidden}>
        <BankingPanel/>
        <BankingComparisonPanel/>
      </div>
      <div className={value === 1 ? '' : classes.hidden}>
        <DiscoveryInfo/>
      </div>
      <div style={{ marginTop: 24 }}>
        <DataSourcePanel/>
      </div>
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <ConsolePanel/>
      </div>
      
      {/* Global Footer & Recommender Launch */}
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Button 
          variant="contained" 
          color="secondary" 
          size="large" 
          onClick={() => setModalOpen(true)}
          style={{ marginBottom: '16px', fontWeight: 'bold' }}
        >
          Launch Card Recommender
        </Button>
        <br/>
        <span style={{ color: '#64748b', fontSize: '0.9rem' }}>
          A Technical Showcase of CDR Product Data.<br/>
        </span>
        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>This tool provides general information only and does not constitute financial advice.</span>
      </div>
      
      <RecommendationModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Container>
  );
}

export default Page;
