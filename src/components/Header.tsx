import { LucideIcon, Menu, Settings, Power } from 'lucide-react';

export const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between px-6 bg-black/50 backdrop-blur-sm border-b border-white/10">
      <div className="flex items-center space-x-4">
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-lg flex items-center justify-center">
          <Menu className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-bold text-white">ACOS Dashboard</h1>
      </div>
      <div className="flex items-center space-x-4">
        <button className="p-2 rounded hover:bg-white/10">
          <Settings className="w-5 h-5 text-cyan-400 hover:text-white" />
        </button>
        <button className="p-2 rounded hover:bg-white/10">
          <Power className="w-5 h-5 text-cyan-400 hover:text-white" />
        </button>
      </div>
    </header>
  );
};