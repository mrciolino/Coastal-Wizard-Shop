import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Simulation from './Simulation';
import './styles.css';

function Root() {
    const [hash, setHash] = useState(() => window.location.hash);
    useEffect(() => {
        const onHash = () => setHash(window.location.hash);
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    return hash === '#sim' ? <Simulation /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);