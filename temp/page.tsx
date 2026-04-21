'use client'

import { useState, useMemo } from 'react'
import signalsData from '@/signals.json'
import { MetricCard } from '@/components/dashboard/MetricCard'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'

type Signal = {
  symbol: string
  signal: 'buy' | 'sell'
  confidence: number
  entryPrice: number
  currentPrice: number
  upperBand: number
  lowerBand: number
  regressionLine: number
  slope: number
  slopeDirection: 'positive' | 'negative'
  rSquared: number
  volatility: number
  holdDaysProjection: {
    optimistic: number
    pessimistic: number
    target: number
  }
  bandDistance: number
  timestamp: string
}

const COLORS = {
  buy: '#10b981',
  sell: '#ef4444',
  buyBg: 'rgba(16, 185, 129, 0.1)',
  sellBg: 'rgba(239, 68, 68, 0.1)',
}

export default function ResearchPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'buy' | 'sell'>('all')
  const [sortBy, setSortBy] = useState<'confidence' | 'symbol'>('confidence')

  const { buySignals, sellSignals } = signalsData as { buySignals: Signal[]; sellSignals: Signal[] }

  const filteredSignals = useMemo(() => {
    let signals = activeTab === 'all'
      ? [...buySignals, ...sellSignals]
      : activeTab === 'buy' ? buySignals : sellSignals

    signals.sort((a, b) => {
      if (sortBy === 'confidence') return b.confidence - a.confidence
      return a.symbol.localeCompare(b.symbol)
    })

    return signals
  }, [activeTab, sortBy, buySignals, sellSignals])

  const stats = useMemo(() => {
    const total = buySignals.length + sellSignals.length
    const avgConfidenceBuy = buySignals.reduce((acc, s) => acc + s.confidence, 0) / buySignals.length
    const avgConfidenceSell = sellSignals.reduce((acc, s) => acc + s.confidence, 0) / sellSignals.length
    const avgVolatilityBuy = buySignals.reduce((acc, s) => acc + s.volatility, 0) / buySignals.length
    const avgVolatilitySell = sellSignals.reduce((acc, s) => acc + s.volatility, 0) / sellSignals.length

    return {
      total,
      buyCount: buySignals.length,
      sellCount: sellSignals.length,
      avgConfidenceBuy,
      avgConfidenceSell,
      avgVolatilityBuy,
      avgVolatilitySell,
    }
  }, [buySignals, sellSignals])

  const pieData = [
    { name: 'Buy Signals', value: stats.buyCount, color: COLORS.buy },
    { name: 'Sell Signals', value: stats.sellCount, color: COLORS.sell },
  ]

  const confidenceDistribution = useMemo(() => {
    const buckets = [
      { range: '0-20', buy: 0, sell: 0 },
      { range: '21-40', buy: 0, sell: 0 },
      { range: '41-60', buy: 0, sell: 0 },
      { range: '61-80', buy: 0, sell: 0 },
      { range: '81-100', buy: 0, sell: 0 },
    ]

    buySignals.forEach(s => {
      const idx = Math.min(Math.floor(s.confidence / 21), 4)
      buckets[idx].buy++
    })

    sellSignals.forEach(s => {
      const idx = Math.min(Math.floor(s.confidence / 21), 4)
      buckets[idx].sell++
    })

    return buckets
  }, [buySignals, sellSignals])

  const topBuySignals = useMemo(() =>
    [...buySignals].sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    [buySignals]
  )

  const topSellSignals = useMemo(() =>
    [...sellSignals].sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    [sellSignals]
  )

  const radarData = useMemo(() => {
    return [
      { metric: 'Confidence', buy: Math.round(stats.avgConfidenceBuy), sell: Math.round(stats.avgConfidenceSell) },
      { metric: 'Volatility', buy: Math.round(stats.avgVolatilityBuy * 10), sell: Math.round(stats.avgVolatilitySell * 10) },
      { metric: 'R² (Buy)', buy: Math.round(buySignals.reduce((acc, s) => acc + s.rSquared, 0) / buySignals.length * 100), sell: 0 },
      { metric: 'Band Dist', buy: Math.round(buySignals.reduce((acc, s) => acc + s.bandDistance, 0) / buySignals.length), sell: Math.round(sellSignals.reduce((acc, s) => acc + s.bandDistance, 0) / sellSignals.length) },
    ]
  }, [stats, buySignals, sellSignals])

  return (
    <div className="space-y-8 pb-20 lg:pb-0">
      {/* Header */}
      <div>
        <h1 className="text-3xl lg:text-4xl font-bold text-white mb-2">
          Research <span className="text-sky-400">Signals</span>
        </h1>
        <p className="text-slate-400">Premium (sell) and discount (buy) signals with metrics and visualizations</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Signals" className="min-w-[140px]">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-bold text-white">{stats.total}</span>
          </div>
        </MetricCard>

        <MetricCard label="Buy Signals" className="min-w-[140px]">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-bold text-emerald-400">{stats.buyCount}</span>
            <span className="text-sm text-slate-500">({((stats.buyCount / stats.total) * 100).toFixed(1)}%)</span>
          </div>
        </MetricCard>

        <MetricCard label="Sell Signals" className="min-w-[140px]">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-bold text-rose-400">{stats.sellCount}</span>
            <span className="text-sm text-slate-500">({((stats.sellCount / stats.total) * 100).toFixed(1)}%)</span>
          </div>
        </MetricCard>

        <MetricCard label="Buy/Sell Ratio" className="min-w-[140px]">
          <span className="text-2xl lg:text-3xl font-bold text-sky-400">
            {(stats.buyCount / stats.sellCount).toFixed(2)}
          </span>
        </MetricCard>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pie Chart */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(148, 163, 184, 0.1)',
          }}
        >
          <h3 className="text-lg font-semibold text-white mb-4">Signal Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(((percent ?? 0) * 100)).toFixed(0)}%`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Confidence Distribution */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(148, 163, 184, 0.1)',
          }}
        >
          <h3 className="text-lg font-semibold text-white mb-4">Confidence Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={confidenceDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="range" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
                <Bar dataKey="buy" fill={COLORS.buy} name="Buy" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sell" fill={COLORS.sell} name="Sell" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Radar Chart */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(148, 163, 184, 0.1)',
          }}
        >
          <h3 className="text-lg font-semibold text-white mb-4">Buy vs Sell Metrics</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.2)" />
                <PolarAngleAxis dataKey="metric" stroke="rgba(255,255,255,0.7)" fontSize={11} />
                <PolarRadiusAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
                <Radar name="Buy" dataKey="buy" stroke={COLORS.buy} fill={COLORS.buy} fillOpacity={0.3} />
                <Radar name="Sell" dataKey="sell" stroke={COLORS.sell} fill={COLORS.sell} fillOpacity={0.3} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Buy */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(15, 23, 42, 0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
          }}
        >
          <h3 className="text-lg font-semibold text-emerald-400 mb-4 flex items-center gap-2">
            <span className="text-xl">BUY</span>
            <span className="text-sm text-slate-400 font-normal">Top 5 by Confidence</span>
          </h3>
          <div className="space-y-3">
            {topBuySignals.map((signal) => (
              <div key={signal.symbol} className="bg-black/30 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="text-white font-bold text-lg">{signal.symbol}</span>
                    <span className="ml-2 text-xs text-slate-500">{signal.timestamp}</span>
                  </div>
                  <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-sm font-medium">
                    {signal.confidence}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-slate-500">Price</span>
                    <p className="text-white font-medium">${signal.currentPrice.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Band Dist</span>
                    <p className="text-white font-medium">{signal.bandDistance.toFixed(1)}%</p>
                  </div>
                  <div>
                    <span className="text-slate-500">R²</span>
                    <p className="text-white font-medium">{signal.rSquared.toFixed(3)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Sell */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(15, 23, 42, 0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
          }}
        >
          <h3 className="text-lg font-semibold text-rose-400 mb-4 flex items-center gap-2">
            <span className="text-xl">SELL</span>
            <span className="text-sm text-slate-400 font-normal">Top 5 by Confidence</span>
          </h3>
          <div className="space-y-3">
            {topSellSignals.map((signal) => (
              <div key={signal.symbol} className="bg-black/30 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="text-white font-bold text-lg">{signal.symbol}</span>
                    <span className="ml-2 text-xs text-slate-500">{signal.timestamp}</span>
                  </div>
                  <span className="bg-rose-500/20 text-rose-400 px-2 py-1 rounded text-sm font-medium">
                    {signal.confidence}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-slate-500">Price</span>
                    <p className="text-white font-medium">${signal.currentPrice.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Band Dist</span>
                    <p className="text-white font-medium">{signal.bandDistance.toFixed(1)}%</p>
                  </div>
                  <div>
                    <span className="text-slate-500">R²</span>
                    <p className="text-white font-medium">{signal.rSquared.toFixed(3)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters and Table */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(148, 163, 184, 0.1)',
        }}
      >
        {/* Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
          <div className="flex gap-2">
            {(['all', 'buy', 'sell'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? tab === 'buy' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                    : tab === 'sell' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50'
                    : 'bg-sky-500/20 text-sky-400 border border-sky-500/50'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'all' ? ` (${stats.total})` : tab === 'buy' ? ` (${stats.buyCount})` : ` (${stats.sellCount})`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'confidence' | 'symbol')}
              className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-sky-500 outline-none"
            >
              <option value="confidence">Confidence</option>
              <option value="symbol">Symbol</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Symbol</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Signal</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium text-sm">Confidence</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium text-sm">Price</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium text-sm">Band Dist</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium text-sm">R²</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium text-sm">Volatility</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium text-sm">Slope</th>
              </tr>
            </thead>
            <tbody>
              {filteredSignals.map((signal) => (
                <tr
                  key={signal.symbol + signal.timestamp}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="py-3 px-4">
                    <span className="text-white font-medium">{signal.symbol}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        signal.signal === 'buy'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {signal.signal.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            signal.signal === 'buy' ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                          style={{ width: `${signal.confidence}%` }}
                        />
                      </div>
                      <span className="text-white font-medium w-10 text-right">{signal.confidence}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-white">${signal.currentPrice.toFixed(2)}</td>
                  <td className="py-3 px-4 text-right text-white">{signal.bandDistance.toFixed(1)}%</td>
                  <td className="py-3 px-4 text-right text-white">{signal.rSquared.toFixed(3)}</td>
                  <td className="py-3 px-4 text-right text-white">{signal.volatility.toFixed(2)}</td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className={
                        signal.slopeDirection === 'positive' ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {signal.slope.toFixed(4)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
