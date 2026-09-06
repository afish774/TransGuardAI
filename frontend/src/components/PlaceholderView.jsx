import React, { memo } from 'react';
import { LayoutDashboard } from 'lucide-react';

const PlaceholderView = memo(({ title }) => {
  return (
    <div className="flex-1 relative bg-gray-50 dark:bg-[#000] p-8 flex items-center justify-center animate-fade-in-up">
      <div className="bg-white dark:bg-zinc-900/90 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl p-12 shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 text-center flex flex-col items-center justify-center max-w-md w-full">
        <LayoutDashboard size={48} className="text-gray-300 dark:text-zinc-700 mb-6" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-2">{title}</h2>
        <p className="text-gray-500 dark:text-zinc-400">This module is currently under development. Detailed views and analytics will be integrated here shortly.</p>
        <button className="mt-8 px-6 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-black font-semibold rounded-lg shadow-sm hover:opacity-90 transition-opacity">
          Notify Me
        </button>
      </div>
    </div>
  );
});

export default PlaceholderView;
