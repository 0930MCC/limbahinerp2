import React from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { useNavigation } from '../lib/navigation.tsx';

interface ModePlaceholderPageProps {
  onReturnToB3: () => void;
}

export function ModePlaceholderPage({
  onReturnToB3,
}: ModePlaceholderPageProps) {
  const { navigatePage } = useNavigation();

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 max-w-2xl">
      <div className="w-11 h-11 rounded-lg bg-[#EAF5F5] text-teal-700 flex items-center justify-center mb-5">
        <Layers className="w-5 h-5" />
      </div>

      <p className="text-xs font-medium text-teal-700">Coming Soon</p>
      <h2 className="mt-1.5 font-display text-2xl font-bold text-slate-900">
        Limbah Domestik Module
      </h2>
      <p className="mt-3 text-sm text-slate-600 leading-relaxed">
        Municipal and non-hazardous domestic waste routing, recurring
        residential and commercial pickup plans, and tonnage billing are
        scheduled for the next LIMBAHIN release.
      </p>

      <div className="mt-6 pt-6 border-t border-slate-100 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            onReturnToB3();
            navigatePage('/b3/dashboard');
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Limbah B3
        </button>
      </div>
    </div>
  );
}
