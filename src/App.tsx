import { useState, useRef, useCallback, useEffect } from 'react';
import type { StudentResult } from './types';
import { gradeTest } from './utils/grader';
import { annotateImage } from './utils/imageAnnotator';
import { exportToExcel, exportToCSV } from './utils/exporter';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import './App.css';

type Tab = 'grade' | 'result' | 'stats';
type GradeStep = 0 | 1 | 2 | 3; // 0=idle 1=読込中 2=AI採点中 3=画像生成中

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function scoreColor(pct: number) {
  return pct >= 80 ? '#16a34a' : pct >= 60 ? '#f59e0b' : '#c8001e';
}

const GRADE_STEPS: Record<GradeStep, string> = {
  0: '',
  1: '画像を読み込み中...',
  2: 'AIが採点中...',
  3: '採点画像を生成中...',
};

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let rafId: number;
    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);
  return count;
}

// ─── Score Circle ─────────────────────────────────────────────────────────────

function ScoreCircle({ correct, total }: { correct: number; total: number }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const animatedPct = useCountUp(pct);
  const animatedCorrect = useCountUp(correct);
  const r = 45;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (animatedPct / 100) * circumference;
  const color = scoreColor(pct);

  return (
    <div className="score-circle-wrapper">
      <svg className="score-svg" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
        <circle
          cx="55" cy="55" r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 55 55)"
        />
      </svg>
      <div className="score-circle-inner">
        <span className="score-num" style={{ color }}>{animatedCorrect}</span>
        <span className="score-denom">/{total}</span>
      </div>
    </div>
  );
}

// ─── Progress Steps ───────────────────────────────────────────────────────────

function GradeProgress({ step }: { step: GradeStep }) {
  const steps = [
    { id: 1, icon: '📷', label: '画像読込' },
    { id: 2, icon: '🤖', label: 'AI採点' },
    { id: 3, icon: '✏️', label: '画像生成' },
  ];
  return (
    <div className="grade-progress">
      <div className="progress-steps">
        {steps.map((s) => (
          <div
            key={s.id}
            className={`progress-step ${
              step > s.id ? 'done' : step === s.id ? 'active' : 'idle'
            }`}
          >
            <div className="progress-dot">
              {step > s.id ? '✓' : s.icon}
            </div>
            <span className="progress-label">{s.label}</span>
          </div>
        ))}
      </div>
      <p className="progress-text">{GRADE_STEPS[step]}</p>
    </div>
  );
}

// ─── Celebration ──────────────────────────────────────────────────────────────

function Celebration({ show }: { show: boolean }) {
  if (!show) return null;
  const emojis = ['★', '✨', '🎉', '○', '★', '✨', '🎊', '★'];
  return (
    <div className="celebration" aria-hidden>
      {emojis.map((e, i) => (
        <span key={i} className="confetti-piece" style={{ '--i': i } as React.CSSProperties}>
          {e}
        </span>
      ))}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>('grade');
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rawDataUrl, setRawDataUrl] = useState<string | null>(null);
  const [gradeStep, setGradeStep] = useState<GradeStep>(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('grader_api_key');
    if (saved) { setApiKey(saved); setKeyInput(saved); }
  }, []);

  const activeResult =
    selectedId
      ? results.find((r) => r.id === selectedId) ?? null
      : results[results.length - 1] ?? null;

  const isGrading = gradeStep > 0;

  // ── File handling ────────────────────────────────────────────────────────

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください（JPEG / PNG）');
      return;
    }
    const url = await readFileAsDataUrl(file);
    setRawDataUrl(url);
    setPreviewUrl(url);
    setError(null);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  };

  const clearImage = () => {
    setPreviewUrl(null);
    setRawDataUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // ── Grade ────────────────────────────────────────────────────────────────

  const handleGrade = async () => {
    if (!studentName.trim()) { setError('生徒名を入力してください'); return; }
    if (!rawDataUrl) { setError('テスト画像を選択してください'); return; }

    setGradeStep(1);
    setError(null);

    try {
      setGradeStep(2);
      const gradeData = await gradeTest(apiKey, rawDataUrl);

      setGradeStep(3);
      const annotated = await annotateImage(rawDataUrl, gradeData.questions);

      const result: StudentResult = {
        id: uid(),
        student_name: studentName.trim(),
        original_image_url: rawDataUrl,
        annotated_image_url: annotated,
        grade_data: gradeData,
        graded_at: new Date().toISOString(),
      };

      setResults((prev) => [...prev, result]);
      setSelectedId(result.id);
      setStudentName('');
      clearImage();
      setTab('result');

      // Celebrate if ≥ 80%
      if (gradeData.total_questions > 0) {
        const pct = (gradeData.total_correct / gradeData.total_questions) * 100;
        if (pct >= 80) {
          setShowCelebration(true);
          setTimeout(() => setShowCelebration(false), 2400);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '採点中にエラーが発生しました');
    } finally {
      setGradeStep(0);
    }
  };

  // ── API key ──────────────────────────────────────────────────────────────

  const saveApiKey = () => {
    const trimmed = keyInput.trim();
    if (trimmed && !trimmed.startsWith('sk-')) {
      setError('APIキーは "sk-" で始まります');
      return;
    }
    setApiKey(trimmed);
    if (trimmed) sessionStorage.setItem('grader_api_key', trimmed);
    else sessionStorage.removeItem('grader_api_key');
    setShowSettings(false);
    setError(null);
  };

  const deleteResult = (id: string) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Share ────────────────────────────────────────────────────────────────

  const handleShare = async (result: StudentResult) => {
    const pct = result.grade_data.total_questions > 0
      ? Math.round((result.grade_data.total_correct / result.grade_data.total_questions) * 100)
      : 0;
    const text = `📝 ${result.student_name}の採点結果\n${result.grade_data.total_correct}/${result.grade_data.total_questions}問正解（${pct}点）\n#テストつけアプリ`;
    if (navigator.share) {
      await navigator.share({ title: 'テストつけアプリ', text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(text).catch(() => {});
      alert('結果をクリップボードにコピーしました');
    }
  };

  // ── Chart data ───────────────────────────────────────────────────────────

  const chartData = results.map((r) => ({
    name: r.student_name.length > 4 ? r.student_name.slice(0, 4) + '…' : r.student_name,
    score:
      r.grade_data.total_questions > 0
        ? Math.round((r.grade_data.total_correct / r.grade_data.total_questions) * 100)
        : 0,
  }));

  const avgScore =
    results.length > 0
      ? Math.round(chartData.reduce((s, d) => s + d.score, 0) / results.length)
      : 0;
  const maxScore = results.length > 0 ? Math.max(...chartData.map((d) => d.score)) : 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <Celebration show={showCelebration} />

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-logo">
            <span className="logo-star">★</span>
            <div>
              <h1 className="header-title">テストつけアプリ</h1>
              <p className="header-sub">AIが自動で採点！すぐに丸つけ！</p>
            </div>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(true)} aria-label="設定">
            ⚙
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="app-main">

        {/* ────────── 採点する Tab ────────── */}
        {tab === 'grade' && (
          <div className="tab-content">
            <div className="card">
              <h2 className="card-title">
                <span className="title-icon">✏️</span>
                テストを採点する
              </h2>

              <div className="form-group">
                <label className="form-label">生徒名</label>
                <input
                  type="text"
                  placeholder="例：田中太郎"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="text-input"
                  disabled={isGrading}
                />
              </div>

              {previewUrl ? (
                <div className="preview-area">
                  <img src={previewUrl} alt="プレビュー" className="preview-img" />
                  <button className="remove-img-btn" onClick={clearImage} disabled={isGrading}>
                    ✕ 別の画像に変更
                  </button>
                </div>
              ) : (
                <div className="upload-buttons">
                  <button
                    className="upload-btn camera-btn"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isGrading}
                  >
                    <span className="upload-btn-icon">📷</span>
                    <span>カメラで撮影</span>
                  </button>
                  <button
                    className="upload-btn gallery-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isGrading}
                  >
                    <span className="upload-btn-icon">🖼️</span>
                    <span>アルバムから</span>
                  </button>
                </div>
              )}

              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden-input" onChange={onFileChange} />
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden-input" onChange={onFileChange} />

              {error && <div className="error-box">{error}</div>}

              {isGrading ? (
                <GradeProgress step={gradeStep} />
              ) : (
                <button
                  className="grade-btn"
                  onClick={handleGrade}
                  disabled={!rawDataUrl || !studentName.trim()}
                >
                  <span>🔍</span>
                  採点スタート！
                </button>
              )}
            </div>

            <div className="tip-card">
              <p><strong>📸 撮って送るだけ！</strong></p>
              <p className="tip-text">
                テスト用紙を撮影か画像を選んで、生徒名を入力してください。AIが自動で○×をつけます！
              </p>
            </div>
          </div>
        )}

        {/* ────────── 結果 Tab ────────── */}
        {tab === 'result' && (
          <div className="tab-content">
            {activeResult ? (
              <>
                <div className="score-card">
                  <div className="score-card-inner">
                    <ScoreCircle
                      correct={activeResult.grade_data.total_correct}
                      total={activeResult.grade_data.total_questions}
                    />
                    <div className="score-info">
                      <p className="score-student">{activeResult.student_name}</p>
                      <ScorePctBig
                        correct={activeResult.grade_data.total_correct}
                        total={activeResult.grade_data.total_questions}
                      />
                      <p className="score-label">
                        {activeResult.grade_data.total_correct}/{activeResult.grade_data.total_questions}問正解
                      </p>
                    </div>
                  </div>

                  {results.length > 1 && (
                    <div className="student-chips">
                      {results.map((r) => (
                        <button
                          key={r.id}
                          className={`student-chip ${
                            (selectedId === r.id || (!selectedId && r === results[results.length - 1]))
                              ? 'active' : ''
                          }`}
                          onClick={() => setSelectedId(r.id)}
                        >
                          {r.student_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card">
                  <h2 className="card-title">
                    <span className="title-icon">📋</span>
                    採点済みテスト
                  </h2>
                  <div className="annotated-wrapper" onClick={() => setExpandedImage(activeResult.annotated_image_url)}>
                    <img src={activeResult.annotated_image_url} alt="採点済みテスト" className="annotated-img" />
                    <div className="tap-hint">タップして拡大</div>
                  </div>
                  <div className="result-action-row">
                    <button
                      className="dl-btn"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = activeResult.annotated_image_url;
                        a.download = `採点済み_${activeResult.student_name}.jpg`;
                        a.click();
                      }}
                    >
                      ⬇ ダウンロード
                    </button>
                    <button className="share-btn" onClick={() => handleShare(activeResult)}>
                      ↗ シェア
                    </button>
                  </div>
                </div>

                <div className="card">
                  <h2 className="card-title">
                    <span className="title-icon">📊</span>
                    問題別の結果
                  </h2>
                  <div className="question-list">
                    {activeResult.grade_data.questions.map((q) => (
                      <div
                        key={q.number}
                        className={`question-row ${q.is_correct ? 'row-correct' : 'row-wrong'}`}
                      >
                        <span className="q-num">問{q.number}</span>
                        <span className="q-answer">{q.student_answer || '（未記入）'}</span>
                        <span className={`q-mark ${q.is_correct ? 'mark-o' : 'mark-x'}`}>
                          {q.is_correct ? '○' : '×'}
                        </span>
                        {!q.is_correct && q.correct_answer && (
                          <span className="q-correct">正解：{q.correct_answer}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <p className="empty-title">まだ採点していません</p>
                <p className="empty-sub">「採点する」タブでテストを<br />撮影して採点しましょう！</p>
                <button className="go-grade-btn" onClick={() => setTab('grade')}>採点する →</button>
              </div>
            )}
          </div>
        )}

        {/* ────────── 統計 Tab ────────── */}
        {tab === 'stats' && (
          <div className="tab-content">
            {results.length > 0 ? (
              <>
                <div className="stats-cards">
                  <div className="stats-card">
                    <p className="stats-label">クラス平均</p>
                    <p className="stats-value">{avgScore}<span className="stats-unit">点</span></p>
                  </div>
                  <div className="stats-card">
                    <p className="stats-label">最高点</p>
                    <p className="stats-value" style={{ color: '#16a34a' }}>
                      {maxScore}<span className="stats-unit">点</span>
                    </p>
                  </div>
                  <div className="stats-card">
                    <p className="stats-label">採点人数</p>
                    <p className="stats-value">{results.length}<span className="stats-unit">名</span></p>
                  </div>
                </div>

                <div className="card">
                  <h2 className="card-title">
                    <span className="title-icon">📊</span>
                    正答率グラフ
                  </h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        formatter={(v: number) => [`${v}%`, '正答率']}
                        contentStyle={{ fontSize: '0.82rem', borderRadius: '8px' }}
                      />
                      <Bar dataKey="score" radius={[5, 5, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={scoreColor(entry.score)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="card">
                  <h2 className="card-title">
                    <span className="title-icon">📋</span>
                    採点一覧（全{results.length}名）
                  </h2>
                  <div className="export-btns">
                    <button className="export-btn" onClick={() => exportToExcel(results)}>📊 Excel出力</button>
                    <button className="export-btn" onClick={() => exportToCSV(results)}>📄 CSV出力</button>
                  </div>
                  <div className="summary-list">
                    {results.map((r) => {
                      const pct = r.grade_data.total_questions > 0
                        ? Math.round((r.grade_data.total_correct / r.grade_data.total_questions) * 100)
                        : 0;
                      return (
                        <div
                          key={r.id}
                          className={`summary-row ${
                            (selectedId === r.id || (!selectedId && r === results[results.length - 1]))
                              ? 'selected' : ''
                          }`}
                          onClick={() => { setSelectedId(r.id); setTab('result'); }}
                        >
                          <span className="summary-name">{r.student_name}</span>
                          <div className="summary-marks">
                            {r.grade_data.questions.slice(0, 10).map((q, i) => (
                              <span key={i} className={`mini-mark ${q.is_correct ? 'mini-o' : 'mini-x'}`}>
                                {q.is_correct ? '○' : '×'}
                              </span>
                            ))}
                            {r.grade_data.questions.length > 10 && (
                              <span className="mini-more">+{r.grade_data.questions.length - 10}</span>
                            )}
                          </div>
                          <span className="summary-score" style={{ color: scoreColor(pct) }}>
                            {r.grade_data.total_correct}/{r.grade_data.total_questions}
                          </span>
                          <button className="delete-btn" onClick={(e) => { e.stopPropagation(); deleteResult(r.id); }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <p className="empty-title">データがありません</p>
                <p className="empty-sub">採点すると自動で<br />統計グラフが表示されます！</p>
                <button className="go-grade-btn" onClick={() => setTab('grade')}>採点する →</button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Bottom Tab Bar ── */}
      <nav className="bottom-nav">
        <button className={`nav-btn ${tab === 'grade' ? 'active' : ''}`} onClick={() => setTab('grade')}>
          <span className="nav-icon">✏️</span>
          <span className="nav-label">採点する</span>
        </button>
        <button className={`nav-btn ${tab === 'result' ? 'active' : ''}`} onClick={() => setTab('result')}>
          <span className="nav-icon">📝</span>
          <span className="nav-label">結果</span>
          {results.length > 0 && <span className="nav-badge">{results.length}</span>}
        </button>
        <button className={`nav-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          <span className="nav-icon">📊</span>
          <span className="nav-label">統計</span>
        </button>
      </nav>

      {/* ── Settings modal ── */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">⚙ 設定</h2>
            <div className="form-group">
              <label className="form-label">APIキー（ローカル開発用）</label>
              <input
                type="password"
                placeholder="sk-ant-... （Vercel環境変数設定時は不要）"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="text-input"
                onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
              />
              <p className="setting-hint">
                Vercel本番環境では環境変数 <strong>ANTHROPIC_API_KEY</strong> を使用します。ローカル開発時のみここに入力してください。
              </p>
            </div>
            {error && <div className="error-box">{error}</div>}
            <div className="modal-btns">
              <button className="modal-cancel" onClick={() => setShowSettings(false)}>キャンセル</button>
              <button className="modal-save" onClick={saveApiKey}>{apiKey ? '更新する' : '設定する'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {expandedImage && (
        <div className="lightbox" onClick={() => setExpandedImage(null)}>
          <img src={expandedImage} alt="拡大表示" className="lightbox-img" />
          <button className="lightbox-close" onClick={() => setExpandedImage(null)}>✕ 閉じる</button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: animated percentage ──────────────────────────────────────

function ScorePctBig({ correct, total }: { correct: number; total: number }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const animated = useCountUp(pct);
  return (
    <div className="score-pct-big" style={{ color: scoreColor(pct) }}>
      {animated}
      <span style={{ fontSize: '1rem', fontWeight: 600 }}>点</span>
    </div>
  );
}
