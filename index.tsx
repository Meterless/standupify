
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { connectStation } from './services/station/client';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
function StartingStudio() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 10_000); return () => clearTimeout(timer); }, []);
  return <div className="room min-h-screen flex items-center justify-center px-6"><div className="text-center max-w-sm" role="status"><div className="w-12 h-12 mx-auto rounded-2xl bg-accent-soft text-accent grid place-items-center text-2xl breathe">◆</div><h1 className="font-display text-3xl mt-5">Opening your club</h1><p className="text-muted text-sm mt-3">Connecting to your saved shows and getting the room ready.</p>{slow && <p className="text-muted text-xs mt-5 leading-relaxed">The Station is taking a little longer to connect. <button className="text-accent underline" onClick={() => location.reload()}>Try again</button></p>}</div></div>;
}
root.render(<StartingStudio />);
// The hosted web demo (`npm run build:web`) simulates the engines in this page; it must be in place first.
declare const __WEB_DEMO__: boolean;
const webDemo = __WEB_DEMO__ ? import('./web/demo-shim').then(m => m.installWebDemo()) : Promise.resolve();
// With `npm start` the Circuit runs in the Station; this page connects before it reads anything.
webDemo.then(() => connectStation()).catch(() => false).finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
