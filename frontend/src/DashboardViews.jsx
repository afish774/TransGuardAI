import React, { useState } from 'react';
import {
  Activity, Users, Camera, AlertTriangle,
  CheckCircle, XCircle, Clock,
  Search, Filter, MoreVertical, Eye, TrendingUp, TrendingDown, BarChart3, Plus, UploadCloud, Brain,
  RefreshCw
} from 'lucide-react';
import WebRTCPlayer from './components/WebRTCPlayer';

// =====================================
// DASHBOARD VIEW
// =====================================
export const DashboardView = () => {
  const stats = [
    { label: 'Active Camera Nodes', value: '0 / 0', icon: Camera, trend: 'Online', color: 'text-gray-500', sparkline: "" },
    { label: 'Unresolved Incidents', value: '0', icon: AlertTriangle, trend: 'High Priority', color: 'text-gray-500', sparkline: "" },
    { label: 'Watchlist Matches', value: '0', icon: Users, trend: 'Last 24h', color: 'text-gray-500', sparkline: "" },
    { label: 'System Health', value: '--%', icon: Activity, trend: '--', color: 'text-gray-500', sparkline: "" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-end mb-8">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(79,70,229,0.4)] transition-all hover:shadow-[0_0_20px_rgba(79,70,229,0.6)] hover:-translate-y-0.5 border border-indigo-400/30">
              <Plus size={14} /> Add Target
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat, i) => (
            <div key={i} className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2 rounded-lg bg-gray-50 dark:bg-white/5 ${stat.color} shadow-inner`}>
                  <stat.icon size={18} />
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 ${stat.color}`}>
                  {stat.trend}
                </span>
              </div>
              <div className="text-sm font-semibold text-gray-500 dark:text-zinc-400 mb-1">{stat.label}</div>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black text-gray-900 dark:text-zinc-100 tracking-tight">{stat.value}</span>
                {/* Mini Sparkline */}
                <svg className="w-16 h-8 opacity-50 group-hover:opacity-100 transition-opacity" viewBox="0 0 50 30">
                  <polyline fill="none" stroke="currentColor" className={stat.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={stat.sparkline} />
                </svg>
              </div>
            </div>
          ))}
        </div>

        {/* Activity & Chart Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Main Area Chart */}
          <div className="col-span-1 lg:col-span-2 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm flex flex-col min-h-[340px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">Network Telemetry (24h)</h3>
              <div className="flex gap-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-zinc-400">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></div> Network Traffic
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-zinc-400">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div> Processed Frames
                </div>
              </div>
            </div>

            <div className="flex-1 w-full relative">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 220" preserveAspectRatio="none">
                {/* Grid */}
                <line x1="0" y1="220" x2="1000" y2="220" stroke="currentColor" className="text-gray-200 dark:text-white/5" strokeWidth="1" />
                <line x1="0" y1="165" x2="1000" y2="165" stroke="currentColor" className="text-gray-200 dark:text-white/5" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" y1="110" x2="1000" y2="110" stroke="currentColor" className="text-gray-200 dark:text-white/5" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" y1="55" x2="1000" y2="55" stroke="currentColor" className="text-gray-200 dark:text-white/5" strokeWidth="1" strokeDasharray="4 4" />

                <defs>
                  <linearGradient id="areaGradBlue" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="areaGradGreen" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Processed Frames (Green) */}
                <polyline points="" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

                {/* Network Traffic (Blue) */}
                <polyline points="" fill="none" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="absolute -bottom-6 left-0 right-0 flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                <span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>Now</span>
              </div>
            </div>
          </div>

          {/* Premium AI Accuracy Status */}
          <div className="col-span-1 bg-gray-900/50 dark:bg-black/40 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-inner relative overflow-hidden flex flex-col justify-between group">
            {/* Background Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -z-10 pointer-events-none group-hover:bg-indigo-500/20 transition-all duration-700"></div>

            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
                <Brain size={18} className="text-indigo-400" /> AI Confidence
              </h3>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                Active
              </span>
            </div>

            {/* Premium Circular Gauge */}
            <div className="flex flex-col items-center justify-center my-6 relative">
              <svg className="w-36 h-36 transform -rotate-90">
                <defs>
                  <linearGradient id="aiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#4f46e5" />
                  </linearGradient>
                  <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                {/* Outer Dashed Track */}
                <circle cx="72" cy="72" r="64" stroke="currentColor" strokeWidth="1" fill="transparent" strokeDasharray="4 4" className="text-gray-300 dark:text-white/10" />
                {/* Inner Solid Track */}
                <circle cx="72" cy="72" r="54" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-gray-100 dark:text-black/40" />
                {/* Animated Gradient Fill */}
                <circle cx="72" cy="72" r="54" stroke="url(#aiGrad)" strokeWidth="10" fill="transparent" strokeDasharray="339.29" strokeDashoffset="17.64" strokeLinecap="round" filter="url(#glow)" className="transition-all duration-1000" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-br from-gray-900 to-gray-500 dark:from-white dark:to-indigo-400 tracking-tighter">
                  --<span className="text-sm font-bold ml-0.5">%</span>
                </span>
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">Global Avg</span>
              </div>
            </div>

            {/* Detection Breakdown with Premium Progress Bars */}
            <div className="space-y-4 text-center text-gray-400 text-sm mt-4">
              Awaiting data...
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Edge Node Status */}
          <div className="col-span-1 lg:col-span-2 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">Edge Node Hardware Status</h3>
              <button className="text-xs font-semibold text-indigo-500 hover:text-indigo-600 transition-colors">View All Nodes</button>
            </div>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-white/5">
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Node ID</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Location</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">CPU Temp</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Load</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {[].map((node, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-6 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-zinc-100">{node.id}</td>
                      <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-500 dark:text-zinc-400">{node.loc}</td>
                      <td className={`py-3 px-6 whitespace-nowrap text-sm font-medium ${parseInt(node.temp) > 70 ? 'text-amber-500' : 'text-gray-600 dark:text-zinc-300'}`}>{node.temp}</td>
                      <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-600 dark:text-zinc-300">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${node.status === 'Offline' ? 'bg-transparent' : parseInt(node.load) > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: node.load === '---' ? '0%' : node.load }}></div>
                          </div>
                          <span className="text-xs">{node.load}</span>
                        </div>
                      </td>
                      <td className="py-3 px-6 whitespace-nowrap">
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-${node.color}-500/10 text-${node.color}-600 dark:text-${node.color}-400 border border-${node.color}-200 dark:border-${node.color}-500/20`}>
                          <span className={`w-1.5 h-1.5 rounded-full bg-${node.color}-500`}></span>
                          {node.status}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Actionable Alerts */}
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">Actionable Alerts</h3>
              <span className="w-5 h-5 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center text-xs font-bold border border-red-500/20">3</span>
            </div>
            <div className="space-y-3">
              {[].map((alert, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-gray-100 dark:hover:border-white/10">
                  <div className={`mt-1 w-2 h-2 rounded-full ${alert.color.replace('text-', 'bg-')} shadow-[0_0_8px_currentColor] opacity-80`}></div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-gray-900 dark:text-zinc-100 tracking-wide">{alert.type}</div>
                    <div className="text-xs font-medium text-gray-500 dark:text-zinc-400 mt-0.5">{alert.cam}</div>
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-bold bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{alert.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// =====================================
// WATCHLIST QUEUE VIEW
// =====================================
export const WatchlistQueueView = () => {
  const pendingReviews = [];
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadFile || !uploadName) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('image', uploadFile);
    formData.append('name', uploadName);
    
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('tg_token')}` },
        body: formData
      });
      if (res.ok) {
        setIsUploadModalOpen(false);
        setUploadName('');
        setUploadFile(null);
        alert('Watchlist target uploaded!');
      } else {
        alert('Upload failed');
      }
    } catch {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-end mb-6">
          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-md flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
              <span className="text-xs font-bold text-gray-700 dark:text-gray-400 uppercase tracking-wider">0 Pending</span>
            </div>
            <button 
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-sm font-semibold shadow-[0_0_15px_rgba(79,70,229,0.4)] transition-all hover:shadow-[0_0_20px_rgba(79,70,229,0.6)] hover:-translate-y-0.5 border border-indigo-400/30"
            >
              <UploadCloud size={16} /> Upload Target Photo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pendingReviews.map((review) => (
            <div key={review.id} className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm flex flex-col">
              <div className="relative h-48 w-full bg-black group overflow-hidden">
                <img src={review.img} alt="Snapshot" className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" />
                {/* Bounding Box Mock */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-32 border-2 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]">
                  <div className="absolute -top-6 left-[-2px] bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 tracking-wider">
                    {review.matchScore}% MATCH
                  </div>
                </div>
              </div>
              <div className="p-5 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-zinc-100">{review.name}</h3>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400 mt-1">
                      <Clock size={12} />
                      <span>{review.time}</span>
                    </div>
                  </div>
                  <div className="text-[10px] font-bold bg-gray-100 dark:bg-white/10 px-2 py-1 rounded text-gray-700 dark:text-zinc-300">
                    {review.id}
                  </div>
                </div>
                <div className="text-sm text-gray-600 dark:text-zinc-400 mb-6 flex-1">
                  <span className="font-semibold text-gray-900 dark:text-zinc-300">Location:</span> {review.location}
                </div>

                <div className="grid grid-cols-2 gap-3 mt-auto">
                  <button className="flex items-center justify-center gap-2 py-2 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-zinc-300 font-semibold text-sm rounded-lg transition-colors">
                    <XCircle size={16} /> Dismiss
                  </button>
                  <button className="flex items-center justify-center gap-2 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors">
                    <CheckCircle size={16} /> Confirm
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fade-in-up">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-4">Upload Target Photo</h2>
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-1">Target Name</label>
                <input type="text" required value={uploadName} onChange={e => setUploadName(e.target.value)} className="w-full bg-gray-50 dark:bg-black/50 border border-gray-300 dark:border-white/10 rounded-lg px-4 py-2 text-gray-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500" placeholder="e.g. John Doe" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-1">Photo</label>
                <input type="file" required accept="image/*" onChange={e => setUploadFile(e.target.files[0])} className="w-full text-gray-900 dark:text-zinc-100" />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsUploadModalOpen(false)} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg">Cancel</button>
                <button type="submit" disabled={uploading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm">
                  {uploading ? 'Uploading...' : 'Upload Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// =====================================
// CAMERA NODES VIEW
// =====================================
export const CameraNodesView = ({ activeCameras = [], token }) => {
  const mediamtxUrl = import.meta.env.VITE_MEDIAMTX_URL || 'http://localhost:8889';
  const mediamtxHlsUrl = import.meta.env.VITE_MEDIAMTX_HLS_URL || 'http://localhost:8888';

  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [cameraId, setCameraId] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState('');

  const handleProvisionSubmit = async (e) => {
    e.preventDefault();
    setIsProvisioning(true);
    setProvisionError('');
    
    try {
      const response = await fetch('/api/edge/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          camera_id: cameraId,
          rtsp_url: rtspUrl
        })
      });

      const data = await response.json();
      if (response.ok) {
        setIsProvisionModalOpen(false);
        setCameraId('');
        setRtspUrl('');
      } else {
        setProvisionError(data.error || 'Failed to provision node.');
      }
    } catch {
      setProvisionError('Network error connecting to server.');
    } finally {
      setIsProvisioning(false);
    }
  };

  // Determine grid columns based on camera count
  const getGridCols = (count) => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 2) return 'grid-cols-1 lg:grid-cols-2';
    if (count <= 4) return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  };

  const onlineCameras = activeCameras.filter(c => c.status === 'ONLINE');
  const offlineCameras = activeCameras.filter(c => c.status !== 'ONLINE');

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight">Camera Grid</h1>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
              {onlineCameras.length} online · {offlineCameras.length} offline · {activeCameras.length} total
            </p>
          </div>
          <button 
            onClick={() => setIsProvisionModalOpen(true)}
            className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <Plus size={14} /> Provision Node
          </button>
        </div>

        {/* Live Camera Grid */}
        {activeCameras.length > 0 ? (
          <div className={`grid ${getGridCols(activeCameras.length)} gap-6 mb-8`}>
            {activeCameras.map((cam) => (
              <WebRTCPlayer
                key={cam.camera_id}
                cameraId={cam.camera_id}
                status={cam.status}
                fps={cam.fps || 0}
                mediamtxUrl={mediamtxUrl}
                mediamtxHlsUrl={mediamtxHlsUrl}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-16 flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <Camera size={28} className="text-gray-300 dark:text-zinc-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">No Cameras Detected</h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 max-w-md">
              Start a Python edge engine instance to register cameras. Each engine pushes a heartbeat every 10 seconds.
            </p>
            <code className="mt-4 text-xs bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-4 py-3 text-gray-600 dark:text-zinc-400 font-mono">
              python trans_guard_engine.py --camera CAM_01 --url 0 --headless
            </code>
          </div>
        )}

        {/* Camera Details Table */}
        {activeCameras.length > 0 && (
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 uppercase tracking-wider">Camera Details</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Camera ID</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Node</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">FPS</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {activeCameras.map((cam, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-gray-100 dark:bg-white/10 flex items-center justify-center">
                            <Camera size={14} className="text-gray-500 dark:text-zinc-400" />
                          </div>
                          <span className="font-semibold text-gray-900 dark:text-zinc-100">{cam.camera_id}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        {cam.status === 'ONLINE' ? (
                          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            Online
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm">
                            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                            Offline
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-sm text-gray-600 dark:text-zinc-400 font-mono">{cam.node_id || '—'}</td>
                      <td className="py-4 px-6 text-sm text-gray-600 dark:text-zinc-400">{cam.fps > 0 ? `${cam.fps.toFixed(1)}` : '—'}</td>
                      <td className="py-4 px-6 text-sm text-gray-600 dark:text-zinc-400">
                        {cam.last_heartbeat ? new Date(cam.last_heartbeat).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Provisioning Modal */}
        {isProvisionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
              <button 
                onClick={() => setIsProvisionModalOpen(false)}
                className="absolute top-4 right-4 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              >
                <XCircle size={20} />
              </button>
              
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-2">Provision AI Node</h2>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">Deploy a new YOLOv8 tracking instance on the edge.</p>

              {provisionError && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
                  {provisionError}
                </div>
              )}

              <form onSubmit={handleProvisionSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-1.5">Camera ID</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CAM_02"
                    value={cameraId}
                    onChange={(e) => setCameraId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-1.5">RTSP Stream URL</label>
                  <input
                    type="text"
                    required
                    placeholder="rtsp://192.168.1.100:554/stream or 0 for webcam"
                    value={rtspUrl}
                    onChange={(e) => setRtspUrl(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                
                <div className="pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsProvisionModalOpen(false)}
                    className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isProvisioning}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-md transition-colors flex items-center gap-2"
                  >
                    {isProvisioning ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        Provisioning...
                      </>
                    ) : (
                      'Deploy Node'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// =====================================
// INSIGHTS VIEW
// =====================================
// =====================================
// INSIGHTS VIEW
// =====================================
export const InsightsView = () => {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-end mb-8">
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 bg-white dark:bg-zinc-900/80 border border-gray-200 dark:border-white/10 text-sm font-semibold rounded-lg shadow-sm">Last 7 Days</button>
            <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-md transition-colors flex items-center gap-2">
              <BarChart3 size={16} /> Generate Report
            </button>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Incidents', value: '0', trend: '0%', isUp: true, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
            { label: 'AI Accuracy', value: '--', trend: '0%', isUp: true, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { label: 'Fleet Safety Score', value: '--/100', trend: '0%', isUp: false, color: 'text-amber-500', bg: 'bg-amber-500/10' },
            { label: 'False Positives', value: '0%', trend: '0%', isUp: true, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          ].map((kpi, i) => (
            <div key={i} className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className={`absolute top-0 right-0 w-24 h-24 rounded-bl-full -mr-4 -mt-4 opacity-50 ${kpi.bg} group-hover:scale-110 transition-transform duration-500`}></div>
              <div className="text-sm font-semibold text-gray-500 dark:text-zinc-400 mb-1">{kpi.label}</div>
              <div className="text-3xl font-bold text-gray-900 dark:text-zinc-100">{kpi.value}</div>
              <div className={`flex items-center gap-1 mt-2 text-xs font-bold ${kpi.isUp ? (kpi.trend.includes('-') ? 'text-emerald-500' : 'text-indigo-500') : 'text-red-500'}`}>
                {kpi.isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                <span>{kpi.trend} from last week</span>
              </div>
            </div>
          ))}
        </div>

        {/* Main Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Trend Chart */}
          <div className="col-span-1 lg:col-span-2 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">7-Day Incident Volume</h3>
              <div className="flex items-center gap-4 text-xs font-semibold text-gray-500 dark:text-zinc-400">
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span> AI Detections</div>
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-zinc-700"></span> Driver Reports</div>
              </div>
            </div>

            <div className="flex-1 min-h-[250px] relative w-full flex items-end">
              {/* Clean SVG Line Chart */}
              <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 200" preserveAspectRatio="none">
                {/* Grid Lines */}
                <line x1="0" y1="200" x2="1000" y2="200" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1" />
                <line x1="0" y1="150" x2="1000" y2="150" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" y1="100" x2="1000" y2="100" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" y1="50" x2="1000" y2="50" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1" strokeDasharray="4 4" />

                {/* AI Detections Gradient Line */}
                <defs>
                  <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#4f46e5" />
                  </linearGradient>
                  <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline points="" fill="none" stroke="url(#lineGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

                {/* Driver Reports Line */}
                <polyline points="" fill="none" stroke="currentColor" className="text-gray-400 dark:text-zinc-600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>

              {/* X-Axis Labels */}
              <div className="absolute -bottom-6 left-0 right-0 flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
              </div>
            </div>
          </div>

          {/* Trigger Breakdown */}
          <div className="col-span-1 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm flex flex-col">
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-6">Trigger Distribution</h3>
            <div className="flex-1 flex flex-col items-center justify-center relative">
              <div className="w-48 h-48 rounded-full border-[12px] border-indigo-500/10 relative flex items-center justify-center shadow-[inset_0_0_20px_rgba(0,0,0,0.1)] dark:shadow-none">
                <div className="absolute inset-[-12px] rounded-full border-[12px] border-transparent border-t-indigo-500 border-r-indigo-500 rotate-45 opacity-90"></div>
                <div className="absolute inset-[-12px] rounded-full border-[12px] border-transparent border-b-amber-500 -rotate-12 opacity-90"></div>
                <div className="absolute inset-[-12px] rounded-full border-[12px] border-transparent border-l-red-500 -rotate-45 opacity-90"></div>

                <div className="text-center">
                  <div className="text-3xl font-black text-gray-900 dark:text-zinc-100">0</div>
                  <div className="text-[10px] text-gray-500 dark:text-zinc-500 uppercase tracking-widest font-bold mt-1">Triggers</div>
                </div>
              </div>
            </div>
            <div className="space-y-3 mt-6 w-full">
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Driver Behavior Trends */}
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-6">Behavior Analysis</h3>
            <div className="space-y-5">
              {[].map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-semibold text-gray-700 dark:text-zinc-300">{item.label}</span>
                    <span className="text-xs font-bold text-gray-900 dark:text-white">{item.score}/100</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-white/5 rounded-full h-2 overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.score}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* High Risk Routes */}
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">High Risk Routes</h3>
              <span className="text-xs text-indigo-500 font-semibold cursor-pointer hover:underline">View Map</span>
            </div>
            <div className="space-y-3">
              {[].map((r, i) => (
                <div key={i} className="p-3 border border-gray-100 dark:border-white/5 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer group">
                  <div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-zinc-100 group-hover:text-indigo-500 transition-colors">{r.route}</div>
                    <div className="text-xs font-medium text-gray-500 dark:text-zinc-500 mt-0.5">{r.incidents} Incidents tracked</div>
                  </div>
                  <div className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border ${r.color}`}>
                    {r.risk}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// =====================================
// MY TEAM VIEW
// =====================================
export const MyTeamView = () => {
  const teamMembers = [];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-6xl mx-auto">
        <div className="h-4"></div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="col-span-1 lg:col-span-2 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-8 shadow-sm">
            <div className="flex items-center gap-6 mb-8 pb-8 border-b border-gray-100 dark:border-white/10">
              <img src="https://ui-avatars.com/api/?name=Jaylon+Philips&background=random" className="w-24 h-24 rounded-full shadow-lg" alt="User" />
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100">Jaylon Philips</h2>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Lead Operations Manager • Admin Role</p>
              </div>
              <button className="ml-auto px-4 py-2 border border-gray-300 dark:border-white/20 rounded-lg text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Edit Profile
              </button>
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">Notification Settings</h3>

              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-lg">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-zinc-100">Critical Incident Alerts</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Push notifications for Passenger Falls or Collisions.</div>
                </div>
                <div className="w-12 h-6 bg-indigo-500 rounded-full relative cursor-pointer shadow-inner">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-lg">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-zinc-100">Watchlist Queue SMS</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">SMS text message for high-confidence face matches.</div>
                </div>
                <div className="w-12 h-6 bg-gray-300 dark:bg-zinc-700 rounded-full relative cursor-pointer shadow-inner">
                  <div className="absolute left-1 top-1 w-4 h-4 bg-white dark:bg-zinc-400 rounded-full shadow-sm"></div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-1 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm flex flex-col">
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-6">Active Roster</h3>
            <div className="space-y-4 flex-1">
              {teamMembers.map((member, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-gray-100 dark:hover:border-white/10">
                  <div className="relative">
                    <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full shadow-sm" />
                    {member.status === 'Online' && <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-zinc-900 rounded-full"></div>}
                    {member.status === 'Offline' && <div className="absolute bottom-0 right-0 w-3 h-3 bg-gray-400 border-2 border-white dark:border-zinc-900 rounded-full"></div>}
                    {member.status === 'Away' && <div className="absolute bottom-0 right-0 w-3 h-3 bg-amber-500 border-2 border-white dark:border-zinc-900 rounded-full"></div>}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-zinc-100">{member.name}</div>
                    <div className="text-xs text-gray-500 dark:text-zinc-400">{member.role}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm rounded-lg hover:opacity-90 transition-opacity">
              + Invite Member
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// =====================================
// DOCS VIEW
// =====================================
export const DocsView = () => {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-6">System Documentation</h1>

        <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl p-8 shadow-sm prose dark:prose-invert max-w-none">
          <h2 className="text-gray-900 dark:text-zinc-100">Getting Started with Edge Nodes</h2>
          <p className="text-gray-600 dark:text-zinc-400">
            Trans Guard AI runs lightweight YOLOv8 nano models directly on edge hardware, streaming minimal telemetry (JSON) over WebSockets to this centralized dashboard.
          </p>

          <h3 className="text-gray-900 dark:text-zinc-100">Provisioning a Tapo C100</h3>
          <ol className="text-gray-600 dark:text-zinc-400 space-y-2">
            <li>Connect the camera to the local depot Wi-Fi network.</li>
            <li>Run the local discovery script: <code>python edge_discovery.py</code>.</li>
            <li>Input the RTSP stream URL into the Trans Guard AI node config.</li>
            <li>The edge script will automatically begin pushing bounding box events.</li>
          </ol>

          <div className="mt-8 p-4 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-lg">
            <h4 className="text-indigo-800 dark:text-indigo-400 font-bold m-0 mb-2">API Documentation</h4>
            <p className="text-indigo-600 dark:text-indigo-300 text-sm m-0">
              For integrating custom AI models, refer to the WebSocket emit standards in the <code>/docs/api</code> repository section. The expected JSON payload must include <code>camera_id</code>, <code>incident_type</code>, and <code>gps</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// =====================================
// INCIDENT LOGS VIEW
// =====================================
export const IncidentLogsView = ({ alerts = [] }) => {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-8 custom-scrollbar animate-fade-in-up flex flex-col h-full">
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100">Incident Logs</h1>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Historical database of all AI triggers and system alerts.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-2 text-gray-400 dark:text-zinc-500" size={16} />
              <input
                type="text"
                placeholder="Search logs..."
                className="w-64 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-700 dark:text-zinc-200 shadow-sm transition-shadow"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 text-gray-700 dark:text-zinc-200 text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <Filter size={14} /> Filters
            </button>
            <button className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm rounded-lg hover:opacity-90 transition-opacity shadow-sm">
              Export CSV
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden">
          <div className="overflow-x-auto flex-1 custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5 sticky top-0 z-10 backdrop-blur-md">
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Time</th>
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Incident ID</th>
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Severity</th>
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Event Type</th>
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Camera Node</th>
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Speed</th>
                  <th className="py-4 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {alerts.map((alert, i) => (
                  <tr key={alert.id || i} className="hover:bg-gray-50/50 dark:hover:bg-white/5 transition-colors group cursor-pointer">
                    <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-500 dark:text-zinc-400">
                      {new Date(alert.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      <span className="font-mono text-xs font-semibold text-gray-900 dark:text-zinc-100 bg-gray-100 dark:bg-white/10 px-2.5 py-1 rounded-md">
                        {(alert.id || alert._id || 'Unknown').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      {alert.incident_type === 'PASSENGER_FALL' || alert.incident_type === 'COLLISION_DETECTED' || alert.incident_type === 'WATCHLIST_MATCH' || alert.incident_type === 'ZONE_INTRUSION' || alert.incident_type === 'UNATTENDED_BAGGAGE' ? (
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-xs uppercase tracking-wide">
                          <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span>
                          Critical
                        </div>
                      ) : alert.incident_type === 'DRIVER_FATIGUE' ? (
                        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs uppercase tracking-wide">
                          <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
                          Warning
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-xs uppercase tracking-wide">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></span>
                          Info
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      {(alert.incident_type || 'Unknown event').replace(/_/g, ' ')}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-600 dark:text-zinc-400">
                      {alert.camera_id}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-600 dark:text-zinc-400">
                      {alert.speed} km/h
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-right flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors p-1" title="View Evidence">
                        <Eye size={16} />
                      </button>
                      <button className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1" title="Options">
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Empty State if no alerts */}
                {alerts.length === 0 && (
                  <tr>
                    <td colSpan="7" className="py-12 text-center text-gray-400 dark:text-zinc-500">
                      <div className="flex flex-col items-center justify-center">
                        <Activity size={32} className="mb-3 opacity-20" />
                        <p>No incidents recorded in the current timeframe.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/5 flex items-center justify-between text-xs text-gray-500 dark:text-zinc-400">
            <span>Showing {alerts.length} records</span>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-50" disabled>Previous</button>
              <button className="px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors bg-white dark:bg-zinc-800 font-medium text-gray-900 dark:text-white shadow-sm">1</button>
              <button className="px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">2</button>
              <button className="px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">3</button>
              <button className="px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
