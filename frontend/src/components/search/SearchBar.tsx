"use client";

import { ArrowUpDown, Loader2, MapPin, Search, X } from "lucide-react";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";

import { mapboxSearchService, type MapboxSuggestion } from "@/src/services/api";

/** A place the user just picked from autocomplete, passed straight to the
 * search so it doesn't depend on parent state that hasn't re-rendered yet. */
export type PlaceSelection = {
  field: "source" | "dest";
  name: string;
  lat: number;
  lng: number;
};

type Props = {
  source: string;
  destination: string;
  onSourceChange: (v: string) => void;
  onDestinationChange: (v: string) => void;
  onSourceCoords?: (lat: number | null, lon: number | null) => void;
  onDestCoords?: (lat: number | null, lon: number | null) => void;
  onSearch: (selection?: PlaceSelection) => void;
  onSwap?: () => void;
  onUseMyLocation?: () => void;
  geoLoading?: boolean;
};

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-cyan-400">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchBar({
  source,
  destination,
  onSourceChange,
  onDestinationChange,
  onSourceCoords,
  onDestCoords,
  onSearch,
  onSwap,
  onUseMyLocation,
  geoLoading,
}: Props) {
  const [focusedField, setFocusedField] = useState<"source" | "dest" | null>(null);
  const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentValue = focusedField === "source" ? source : destination;

  const fetchSuggestions = useCallback(async (query: string) => {
    setIsSearching(true);
    try {
      const results = await mapboxSearchService.suggest(query);
      setSuggestions(results);
    } catch { /* keep stale */ }
    setIsSearching(false);
  }, []);

  const triggerSuggest = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.trim().length < 2) {
        setSuggestions([]);
        setIsSearching(false);
        return;
      }
      debounceRef.current = setTimeout(() => fetchSuggestions(query), 300);
    },
    [fetchSuggestions],
  );

  const handleInput = useCallback(
    (value: string, field: "source" | "dest") => {
      if (field === "source") {
        onSourceChange(value);
        onSourceCoords?.(null, null);
      } else {
        onDestinationChange(value);
        onDestCoords?.(null, null);
      }
      triggerSuggest(value);
    },
    [onSourceChange, onDestinationChange, onSourceCoords, onDestCoords, triggerSuggest],
  );

  const handleSelect = useCallback(
    async (sug: MapboxSuggestion) => {
      const label = sug.name;
      if (focusedField === "source") onSourceChange(label);
      else onDestinationChange(label);
      setSuggestions([]);
      setFocusedField(null);

      setIsRetrieving(true);
      const result = await mapboxSearchService.retrieve(sug.mapbox_id);
      setIsRetrieving(false);

      if (result && focusedField) {
        const name = result.name || label;
        if (focusedField === "source") {
          onSourceChange(name);
          onSourceCoords?.(result.lat, result.lng);
        } else {
          onDestinationChange(name);
          onDestCoords?.(result.lat, result.lng);
        }
        const other = focusedField === "source" ? destination : source;
        if (other) onSearch({ field: focusedField, name, lat: result.lat, lng: result.lng });
      }
    },
    [focusedField, source, destination, onSourceChange, onDestinationChange, onSourceCoords, onDestCoords, onSearch],
  );

  const handleSwap = useCallback(() => {
    if (onSwap) {
      onSwap();
      return;
    }
    const tmpSrc = source;
    const tmpDst = destination;
    onSourceChange(tmpDst);
    onDestinationChange(tmpSrc);
    onSourceCoords?.(null, null);
    onDestCoords?.(null, null);
  }, [source, destination, onSwap, onSourceChange, onDestinationChange, onSourceCoords, onDestCoords]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setSuggestions([]);
        setFocusedField(null);
      }
      if (e.key !== "Enter" || !source || !destination) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSuggestions([]);
      setFocusedField(null);
      e.currentTarget.blur();
      onSearch();
    },
    [source, destination, onSearch],
  );

  const showLocationOption = focusedField === "source" && !source && onUseMyLocation;
  const hasDropdown =
    focusedField !== null &&
    (showLocationOption || isSearching || suggestions.length > 0 || currentValue.trim().length >= 2);

  return (
    <div id="search-bar" ref={containerRef} className="absolute top-4 left-4 z-[1100] w-[360px] animate-fade-in">
      <div className={`glass-card rounded-2xl overflow-hidden transition-opacity duration-200 ${isRetrieving ? "opacity-70" : ""}`}>
        <div className="flex">
          {/* Left: route dots + connecting line */}
          <div className="flex flex-col items-center py-4 pl-4 gap-0">
            <div className="w-3 h-3 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30 shrink-0" />
            <div className="w-0.5 flex-1 bg-white/15 my-1 min-h-[16px]" />
            <div className="w-3 h-3 rounded-full bg-rose-400 ring-2 ring-rose-400/30 shrink-0" />
          </div>

          {/* Center: inputs */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center px-3 py-3 gap-2">
              <input
                type="text"
                placeholder="Where from?"
                value={source}
                onChange={(e) => handleInput(e.target.value, "source")}
                onFocus={() => { setFocusedField("source"); triggerSuggest(source); }}
                onBlur={() => setTimeout(() => {
                  if (!containerRef.current?.contains(document.activeElement)) setFocusedField(null);
                }, 80)}
                onKeyDown={handleKeyDown}
                className="flex-1 text-sm text-white placeholder-white/40 outline-none bg-transparent tracking-wide"
              />
              {source && (
                <button
                  type="button"
                  onClick={() => { onSourceChange(""); onSourceCoords?.(null, null); setSuggestions([]); }}
                  className="text-white/30 hover:text-white/70 cursor-pointer transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="mx-3 h-px bg-slate-700/60" />

            <div className="flex items-center px-3 py-3 gap-2">
              <input
                type="text"
                placeholder="Where to?"
                value={destination}
                onChange={(e) => handleInput(e.target.value, "dest")}
                onFocus={() => { setFocusedField("dest"); triggerSuggest(destination); }}
                onBlur={() => setTimeout(() => {
                  if (!containerRef.current?.contains(document.activeElement)) setFocusedField(null);
                }, 80)}
                onKeyDown={handleKeyDown}
                className="flex-1 text-sm text-white placeholder-white/40 outline-none bg-transparent tracking-wide"
              />
              {source && destination && (
                <button
                  type="button"
                  onClick={() => onSearch()}
                  className="text-cyan-400 hover:text-cyan-300 cursor-pointer transition-colors"
                >
                  <Search size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Right: swap button */}
          <div className="flex items-center pr-3">
            <button
              type="button"
              onClick={handleSwap}
              className="w-8 h-8 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white/50 hover:text-white cursor-pointer transition-all"
              title="Swap origin and destination"
            >
              <ArrowUpDown size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Autocomplete dropdown */}
      {hasDropdown && (
        <div className="mt-2 glass-card rounded-xl max-h-72 overflow-y-auto animate-slide-up">
          {showLocationOption && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onUseMyLocation?.(); setFocusedField(null); }}
              className="w-full text-left px-4 py-3.5 text-sm text-cyan-400 hover:bg-slate-800 flex items-center gap-3 cursor-pointer border-b border-slate-700/40 transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
                <MapPin size={13} className="text-cyan-400" />
              </div>
              {geoLoading ? "Locating you..." : "Use my location"}
            </button>
          )}

          {isSearching && (
            <div className="px-4 py-3 text-sm text-white/40 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin shrink-0" />
              Searching...
            </div>
          )}

          {suggestions.map((sug, i) => (
            <button
              key={`${sug.mapbox_id}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(sug)}
              className="w-full text-left px-4 py-3.5 hover:bg-slate-800 active:bg-cyan-500/15 flex items-center gap-3 cursor-pointer border-b border-slate-700/40 last:border-0 transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg bg-slate-700 group-hover:bg-cyan-500/20 flex items-center justify-center shrink-0 transition-colors">
                <MapPin size={13} className="text-white/40 group-hover:text-cyan-400 transition-colors" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white/90 truncate">
                  {highlightMatch(sug.name, currentValue)}
                </p>
                {sug.full_address && (
                  <p className="text-xs text-white/35 truncate mt-0.5">{sug.full_address}</p>
                )}
              </div>
            </button>
          ))}

          {!isSearching && suggestions.length === 0 && currentValue.trim().length >= 2 && (
            <div className="px-4 py-3 text-sm text-white/30">
              No results for &quot;{currentValue}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
