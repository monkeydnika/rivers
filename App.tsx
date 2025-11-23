import React from 'react';
import { RiverRaidGame } from './components/RiverRaidGame';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white relative overflow-hidden touch-none">
      <div className="absolute inset-0 pointer-events-none opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-green-900 via-zinc-950 to-zinc-950"></div>
      
      <header className="mb-2 z-10 text-center pt-2">
        <h1 className="text-yellow-400 text-lg md:text-3xl mb-1 tracking-widest drop-shadow-lg">JET STREAM: RIVER STRIKE</h1>
        <p className="text-[10px] text-zinc-400 hidden md:block">Arrows: Move/Speed | Space: Fire | R: Restart</p>
      </header>

      <main className="relative z-10 shadow-2xl border-4 border-zinc-800 rounded-lg overflow-hidden bg-black w-full max-w-[600px]">
        <RiverRaidGame />
      </main>

      <footer className="mt-2 text-[10px] text-zinc-600 z-10 pb-2 hidden md:block">
        HTML5 Canvas • TypeScript • React
      </footer>
    </div>
  );
};

export default App;