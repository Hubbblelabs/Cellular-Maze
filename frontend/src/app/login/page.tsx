"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/src/services/auth";
import { useAuth } from "@/src/hooks/useAuth";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  TowerControl,
  Compass,
  MapPin,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const FEATURES = [
  {
    icon: Compass,
    title: "Intelligent Routing",
    desc: "Experience navigation scored by true connectivity and time.",
  },
  {
    icon: TowerControl,
    title: "Precision Data",
    desc: "Powered by comprehensive cell tower analytics.",
  },
];

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { setToken } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const data = await login(username, password);
      setToken(data.access_token || data.token);
      router.push("/");
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to sign in. Please verify your credentials.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: "easeOut" as const },
    },
  };

  return (
    <div className="flex justify-center min-h-screen bg-[#f4f1ea] selection:bg-[#2c3e50] selection:text-[#f4f1ea] font-sans">
      {/* Left Panel - Classic Aesthetic */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="hidden lg:flex lg:w-[50%] relative overflow-hidden flex-col justify-center items-center px-16 bg-[#1a2530]"
      >
        {/* Subtle vintage map-like texture / ambient glow */}
        <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 pointer-events-none" />

        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="relative z-10 max-w-lg text-[#f4f1ea]"
        >
          <motion.div
            variants={itemVariants}
            className="flex items-center gap-4 mb-6"
          >
            <div className="w-14 h-14 rounded-full border border-[#d4af37]/30 flex items-center justify-center bg-[#2c3e50] shadow-[0_0_15px_rgba(212,175,55,0.1)]">
              <MapPin className="text-[#d4af37]" strokeWidth={1.5} size={28} />
            </div>
            <div>
              <h1 className="text-4xl font-serif tracking-wide">Cellular Maze</h1>
              <p className="text-[#aeb6bf] text-sm uppercase tracking-widest mt-1 font-medium">
                Modern Cartography
              </p>
            </div>
          </motion.div>

          <motion.h2
            variants={itemVariants}
            className="text-3xl font-serif text-white/95 mb-4 leading-tight"
          >
            Navigation elevated.
            <br />
            <span className="text-[#d4af37] italic">Connectivity assured.</span>
          </motion.h2>

          <motion.p
            variants={itemVariants}
            className="text-[#aeb6bf] text-base mb-8 leading-relaxed max-w-md font-light"
          >
            Traverse the modern landscape with the elegance of traditional
            guidance, empowered by predictive cellular intelligence.
          </motion.p>

          <motion.div
            variants={containerVariants}
            className="grid grid-cols-2 gap-x-8 gap-y-8"
          >
            {FEATURES.map((feat) => (
              <motion.div
                key={feat.title}
                variants={itemVariants}
                className="group cursor-default"
              >
                <feat.icon
                  className="text-[#d4af37] mb-3 opacity-80 group-hover:opacity-100 transition-opacity duration-500"
                  strokeWidth={1.5}
                  size={24}
                />
                <h3 className="text-[#f4f1ea] text-sm uppercase tracking-wider font-semibold mb-2">
                  {feat.title}
                </h3>
                <p className="text-[#8e98a3] text-xs leading-relaxed font-light">
                  {feat.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        <div className="absolute inset-0 bg-[#f4f1ea] opacity-50 pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md relative z-10"
        >
          {/* Mobile Header */}
          <div className="lg:hidden flex flex-col items-center gap-3 mb-6 justify-center">
            <div className="w-12 h-12 rounded-full border border-[#d4af37]/40 flex items-center justify-center bg-[#1a2530]">
              <MapPin className="text-[#d4af37]" strokeWidth={1.5} size={24} />
            </div>
            <span className="text-3xl font-serif text-[#1a2530]">
              Cellular Maze
            </span>
          </div>

          <div className="bg-white/80 backdrop-blur-xl border border-[#e5e0d8] shadow-2xl shadow-[#1a2530]/5 rounded-2xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <h2 className="text-3xl font-serif text-[#1a2530] tracking-tight">
                Welcome
              </h2>
              <p className="text-sm text-[#7f8c8d] mt-2 font-light">
                Enter your credentials to continue your journey.
              </p>
            </div>

            {/* Elegant Tabs */}
            <div className="flex mb-6 border-b border-[#e5e0d8]">
              <div className="flex-1 text-center pb-3 text-sm font-semibold text-[#1a2530] border-b-2 border-[#1a2530] cursor-default">
                Sign In
              </div>
              <Link
                href="/register"
                className="flex-1 text-center pb-3 text-sm font-medium text-[#95a5a6] hover:text-[#1a2530] transition-colors"
              >
                Create Account
              </Link>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-[#c0392b]/10 border border-[#c0392b]/20 text-[#c0392b] text-sm rounded-lg px-4 py-3"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-1">
                <label
                  htmlFor="login-username"
                  className="block text-xs uppercase tracking-wider font-semibold text-[#34495e]"
                >
                  Username
                </label>
                <div className="relative group">
                  <Mail
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#bdc3c7] transition-colors group-focus-within:text-[#1a2530]"
                    size={18}
                    strokeWidth={1.5}
                  />
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    className="w-full bg-transparent border-b border-[#bdc3c7] pl-12 pr-4 py-3 text-sm text-[#2c3e50] placeholder-[#bdc3c7] outline-none focus:border-[#1a2530] transition-colors"
                    placeholder="Your identifier"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="login-password"
                  className="block text-xs uppercase tracking-wider font-semibold text-[#34495e]"
                >
                  Password
                </label>
                <div className="relative group">
                  <Lock
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#bdc3c7] transition-colors group-focus-within:text-[#1a2530]"
                    size={18}
                    strokeWidth={1.5}
                  />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    className="w-full bg-transparent border-b border-[#bdc3c7] pl-12 pr-12 py-3 text-sm text-[#2c3e50] placeholder-[#bdc3c7] outline-none focus:border-[#1a2530] transition-colors"
                    placeholder="Your secure key"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-[#bdc3c7] hover:text-[#1a2530] p-3 transition-colors cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff size={18} strokeWidth={1.5} />
                    ) : (
                      <Eye size={18} strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                type="submit"
                disabled={isLoading}
                className="w-full py-3 mt-2 bg-[#1a2530] hover:bg-[#2c3e50] text-[#f4f1ea] text-sm font-semibold uppercase tracking-wider rounded-none transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-3">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{
                        repeat: Infinity,
                        duration: 1,
                        ease: "linear",
                      }}
                      className="w-4 h-4 border-2 border-[#f4f1ea]/30 border-t-[#f4f1ea] rounded-full"
                    />
                    Authenticating
                  </span>
                ) : (
                  "Sign In"
                )}
              </motion.button>
            </form>

            

           
          
          </div>
        </motion.div>
      </div>
    </div>
  );
}
