"use client";

import { useCallback, useEffect, useState } from "react";
import { X, ChevronRight, Search, Filter, Map, MessageCircle, Navigation } from "lucide-react";

const TOUR_STEPS = [
  {
    target: "search-bar",
    title: "Search Locations",
    description: "Enter your start and destination. We'll find routes with the best cellular connectivity.",
    icon: Search,
    position: "bottom-right" as const,
  },
  {
    target: "filter-panel",
    title: "Adjust Preferences",
    description: "Use the slider to balance between speed and signal quality. Filter by your carrier too.",
    icon: Filter,
    position: "bottom-left" as const,
  },
  {
    target: "map-area",
    title: "Interactive Map",
    description: "View routes color-coded by signal strength. Drag pins to adjust your path. Hover routes for details.",
    icon: Map,
    position: "center" as const,
  },
  {
    target: "chatbot-btn",
    title: "AI Route Assistant",
    description: "Chat with our AI to get personalized route recommendations based on your needs.",
    icon: MessageCircle,
    position: "bottom-left" as const,
  },
  {
    target: "action-btns",
    title: "Quick Actions",
    description: "Track your location, start live navigation, or trigger a smart reroute when signal drops.",
    icon: Navigation,
    position: "top-left" as const,
  },
];

type Props = {
  onComplete: () => void;
};

export function OnboardingTour({ onComplete }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isFirstVisit = localStorage.getItem("cellularmaze_first_visit");
    const tourCompleted = localStorage.getItem("cellularmaze_tour_done");
    if (isFirstVisit && !tourCompleted) {
      // Small delay to let the page render
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const handleComplete = useCallback(() => {
    localStorage.setItem("cellularmaze_tour_done", "true");
    localStorage.removeItem("cellularmaze_first_visit");
    setVisible(false);
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }, [currentStep, handleComplete]);

  if (!visible) return null;

  const step = TOUR_STEPS[currentStep];
  const StepIcon = step.icon;
  const progress = ((currentStep + 1) / TOUR_STEPS.length) * 100;

  return (
    <div className="tour-overlay" onClick={(e) => e.stopPropagation()}>
      {/* Tooltip card */}
      <div
        className="tour-tooltip"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Progress bar */}
        <div className="w-full h-1 bg-gray-100 rounded-full mb-5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
            <StepIcon size={20} className="text-white" />
          </div>
          <span className="text-xs text-gray-400 font-medium">
            Step {currentStep + 1} of {TOUR_STEPS.length}
          </span>
        </div>

        <h3 className="text-lg font-bold text-gray-900 mb-2">{step.title}</h3>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">{step.description}</p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleComplete}
            className="text-sm text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
          >
            Skip Tour
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-sm font-semibold rounded-xl cursor-pointer hover:shadow-lg hover:shadow-blue-500/20 transition-all flex items-center gap-2"
          >
            {currentStep < TOUR_STEPS.length - 1 ? (
              <>
                Next
                <ChevronRight size={16} />
              </>
            ) : (
              "Got it!"
            )}
          </button>
        </div>

        {/* Close */}
        <button
          type="button"
          onClick={handleComplete}
          className="absolute top-4 right-4 text-gray-300 hover:text-gray-500 cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
