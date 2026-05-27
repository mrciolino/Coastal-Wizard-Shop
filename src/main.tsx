import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Simulation from './Simulation';
import './styles.css';

function Root() {
    const [path, setPath] = useState(() => window.location.pathname);
    useEffect(() => {
        const onPop = () => setPath(window.location.pathname);
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    if (path === '/sim') return <Simulation />;
    return <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);