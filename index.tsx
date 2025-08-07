import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- INTERFACES ---
interface Quest {
    id: string;
    title: string;
    description: string;
    xp: number;
    type: 'static' | 'distance'; // static: pushups, distance: km
    goal: number;
    progress: number;
}

interface Skill {
    name: string;
    level: number;
    description: string;
}

interface UserState {
    level: number;
    xp: number;
    difficulty: string;
    quests: Quest[];
    skills: Skill[];
    name: string;
    lastLogin: string; // ISO date string
    dailySteps: number;
    dailyDistance: number; // in km
}

// --- CONSTANTS ---
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });
const XP_PER_LEVEL = 100;
const STEPS_PER_KM = 1350; // Average steps per kilometer

const INITIAL_QUESTIONS = [
    "What is your name, user?",
    "How many days a week can you realistically dedicate to physical tasks?",
    "How many minutes can you set aside on those days?",
    "On a scale of 1-10, how would you rate your current cardiovascular endurance (e.g., running, swimming)?",
    "On a scale of 1-10, how would you rate your current muscular strength (e.g., lifting, push-ups)?",
    "Describe your current weekly physical activity. Be specific.",
    "What are your primary fitness goals? (e.g., lose weight, build muscle, improve endurance)",
    "Do you have access to a gym or any workout equipment?",
    "Are there any physical limitations or injuries the System should be aware of?",
    "How many push-ups can you do in a single set?",
    "How far can you run without stopping (in kilometers)?",
    "How well do you handle repetitive tasks?",
    "What motivates you to push your limits?"
];

// --- API & HELPERS ---

const parseAiJson = (text: string) => {
    const match = text.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})|(\[[\s\S]*\])/);
    if (match) {
        const jsonStr = match[1] || match[2] || match[3];
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Failed to parse extracted JSON:", e);
            return null;
        }
    }
    console.error("No valid JSON block found in AI response.");
    return null;
}

const getAiResponse = async (prompt: string, schema: any) => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
            }
        });
        const parsed = parseAiJson(response.text);
        if (!parsed) {
             throw new Error("Failed to parse AI response");
        }
        return parsed;
    } catch (error) {
        console.error("Error communicating with The System:", error);
        return null;
    }
};

const haversineDistance = (coords1: GeolocationCoordinates, coords2: GeolocationCoordinates): number => {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371; // Earth radius in km

    const dLat = toRad(coords2.latitude - coords1.latitude);
    const dLon = toRad(coords2.longitude - coords1.longitude);
    const lat1 = toRad(coords1.latitude);
    const lat2 = toRad(coords2.latitude);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // in km
};


// --- COMPONENTS ---

const Loader = ({ text }: { text: string }) => (
    <div className="loading-overlay">
        <p>{text}</p>
    </div>
);

const SystemPanel = ({ title, children, className, titleClassName }: { title: string, children?: React.ReactNode, className?: string, titleClassName?: string }) => (
    <div className={`system-panel ${className || ''}`}>
        <h2 className={`panel-title ${titleClassName || ''}`}>{title}</h2>
        {children}
    </div>
);

const ProgressBar = ({ current, max }: { current: number, max: number }) => {
    const percentage = Math.min((current / max) * 100, 100);
    return (
        <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${percentage}%` }}></div>
        </div>
    );
};

const Questionnaire = ({ onComplete }: { onComplete: (state: UserState) => void }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<string[]>([]);
    const [currentAnswer, setCurrentAnswer] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleNext = async () => {
        const newAnswers = [...answers, currentAnswer];
        setAnswers(newAnswers);
        setCurrentAnswer("");

        if (currentIndex < INITIAL_QUESTIONS.length - 1) {
            setCurrentIndex(currentIndex + 1);
        } else {
            setIsLoading(true);
            const prompt = `You are 'The System' from Solo Leveling. A new user requires assessment. Analyze their answers and assign an initial state.
            Answers:
            ${newAnswers.map((a, i) => `${INITIAL_QUESTIONS[i]}: ${a}`).join('\n')}

            Based on this, determine a difficulty Rank (E, D, C, B, A, S) and generate 3 initial daily quests (mix of 'static' and 'distance' types). The user's name is in the first answer.`;
            
            const schema = {
                type: Type.OBJECT,
                properties: {
                    difficulty: { type: Type.STRING },
                    quests: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                title: { type: Type.STRING },
                                description: { type: Type.STRING },
                                xp: { type: Type.INTEGER },
                                type: { type: Type.STRING, description: "The type of quest, either 'static' for exercises like push-ups or 'distance' for activities like running in kilometers." },
                                goal: { type: Type.NUMBER },
                            }
                        }
                    }
                }
            };
            
            const aiData = await getAiResponse(prompt, schema);

            if(aiData) {
                 const initialState: UserState = {
                    name: newAnswers[0] || 'Player',
                    level: 1,
                    xp: 0,
                    difficulty: aiData.difficulty,
                    quests: aiData.quests.map((q: any) => ({ ...q, progress: 0 })),
                    skills: [],
                    lastLogin: new Date().toISOString(),
                    dailySteps: 0,
                    dailyDistance: 0,
                };
                onComplete(initialState);
            } else {
                alert("The System is currently unavailable. Please try again later.");
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="questionnaire-container">
            {isLoading && <Loader text="ANALYZING..." />}
            <SystemPanel title={`Question ${currentIndex + 1}/${INITIAL_QUESTIONS.length}`}>
                <p className="question-text">{INITIAL_QUESTIONS[currentIndex]}</p>
                <textarea
                    className="system-input"
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                    rows={4}
                />
                <button className="system-button" onClick={handleNext} disabled={!currentAnswer.trim()}>
                    {currentIndex < INITIAL_QUESTIONS.length - 1 ? 'Next' : 'Submit to System'}
                </button>
            </SystemPanel>
        </div>
    );
};

const QuestItem = ({ quest, onUpdate, onToggleTracking, isTracking }: { quest: Quest, onUpdate: (id: string, value: number) => void, onToggleTracking: (id: string) => void, isTracking: boolean }) => {
    const [logValue, setLogValue] = useState('');
    const isCompleted = quest.progress >= quest.goal;
    
    const handleLogSubmit = () => {
        const value = parseInt(logValue, 10);
        if (!isNaN(value) && value > 0) {
            onUpdate(quest.id, value);
            setLogValue('');
        }
    }
    
    return (
         <li className={`quest-item ${isCompleted ? 'completed' : ''} ${isTracking ? 'tracking' : ''}`}>
            <h3 className="quest-title">{quest.title}</h3>
            <p>{quest.description}</p>
            <ProgressBar current={quest.progress} max={quest.goal} />
            <div className="quest-progress-text">
                {quest.type === 'distance' ? `${quest.progress.toFixed(2)} / ${quest.goal.toFixed(2)} km` : `${quest.progress} / ${quest.goal}`}
            </div>
            <span className="quest-rewards">Reward: {quest.xp} XP</span>
            
            {!isCompleted && (
                 <div className="quest-actions">
                     {quest.type === 'static' && (
                         <>
                             <input type="number" className="system-input small" placeholder="Reps..." value={logValue} onChange={(e) => setLogValue(e.target.value)} />
                             <button className="system-button" onClick={handleLogSubmit} disabled={!logValue}>Log Progress</button>
                         </>
                     )}
                     {quest.type === 'distance' && (
                         <button className="system-button" onClick={() => onToggleTracking(quest.id)}>
                             {isTracking ? 'Stop Tracking' : 'Start Tracking'}
                         </button>
                     )}
                 </div>
            )}
            {isCompleted && <p className="quest-complete-notice">COMPLETED</p>}
        </li>
    );
}


const Dashboard = ({ userState, onUpdateQuest, onToggleTracking, activeTrackingQuestId, setView }: { userState: UserState, onUpdateQuest: (id: string, val: number) => void, onToggleTracking: (id: string) => void, activeTrackingQuestId: string | null, setView: (view: string) => void }) => {
    const { name, level, xp, difficulty, quests, dailySteps, dailyDistance } = userState;
    const maxXp = XP_PER_LEVEL * level;

    return (
        <div className="app-container">
            <SystemPanel title={`Player: ${name}`}>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">Level</span>
                        <span>{level}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Difficulty</span>
                        <span>{difficulty}</span>
                    </div>
                     <div className="stat-item">
                        <span className="stat-label">Daily Steps</span>
                        <span>{Math.floor(dailySteps)}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Daily Distance</span>
                        <span>{dailyDistance.toFixed(2)} km</span>
                    </div>
                </div>
                <ProgressBar current={xp} max={maxXp} />
                <div style={{ textAlign: 'right', marginTop: '0.25rem' }}>{xp} / {maxXp} XP</div>
            </SystemPanel>

            <SystemPanel titleClassName="danger" title="[!] Daily Quests">
                <ul className="quest-list">
                    {quests.map(quest => (
                        <QuestItem 
                            key={quest.id} 
                            quest={quest} 
                            onUpdate={onUpdateQuest} 
                            onToggleTracking={onToggleTracking}
                            isTracking={activeTrackingQuestId === quest.id}
                        />
                    ))}
                </ul>
            </SystemPanel>

            <SystemPanel title="Menu">
                <button className="system-button" onClick={() => setView('skills')}>
                    Skills
                </button>
                <button className="system-button danger" onClick={() => {
                    if(window.confirm("Are you sure you want to reset all progress? This cannot be undone.")) {
                         localStorage.removeItem("soloLevelingUserState");
                         window.location.reload();
                    }
                }}>
                    Reset Progress
                </button>
            </SystemPanel>
        </div>
    );
};

const SkillsPage = ({ skills, setView }: { skills: Skill[], setView: (view: string) => void }) => (
    <div className="app-container">
        <SystemPanel title="Skills">
             {skills.length === 0 ? (
                <p>No skills acquired. Complete special quests to unlock skills.</p>
            ) : (
                <table className="skills-table">
                    <thead>
                        <tr>
                            <th>Skill</th>
                            <th>Level</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        {skills.map(skill => (
                            <tr key={skill.name}>
                                <td data-label="Skill">{skill.name}</td>
                                <td data-label="Level">{skill.level}</td>
                                <td data-label="Description">{skill.description}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
             <button className="system-button" onClick={() => setView('dashboard')}>
                Back to Dashboard
            </button>
        </SystemPanel>
    </div>
);

const LevelUpNotification = ({ level, onAcknowledge }: {level: number, onAcknowledge: () => void}) => (
    <div className="notification">
        <SystemPanel title="[!] LEVEL UP" titleClassName="danger">
            <p style={{textAlign: 'center', fontSize: '1.5rem', margin: '1rem 0'}}>Congratulations, you have reached Level {level}.</p>
            <button className="system-button" onClick={onAcknowledge}>Continue</button>
        </SystemPanel>
    </div>
);

const App = () => {
    const [userState, setUserState] = useState<UserState | null>(null);
    const userStateRef = useRef(userState);
    userStateRef.current = userState;

    const [view, setView] = useState('dashboard');
    const [isLoading, setIsLoading] = useState(true);
    const [loadingText, setLoadingText] = useState("SYSTEM STARTING...");
    const [notification, setNotification] = useState<string | null>(null);
    const [showSync, setShowSync] = useState(false);
    const prevLevelRef = useRef<number>();
    
    const [activeTrackingQuestId, setActiveTrackingQuestId] = useState<string | null>(null);
    const questWatchIdRef = useRef<number | null>(null);
    const lastQuestPositionRef = useRef<GeolocationPosition | null>(null);
    
    const saveStateAndSync = useCallback((stateToSave: UserState) => {
        localStorage.setItem("soloLevelingUserState", JSON.stringify(stateToSave));
        setShowSync(true);
        const timeoutId = setTimeout(() => setShowSync(false), 1500);
        return () => clearTimeout(timeoutId);
    }, []);

    const updateAndSaveState = useCallback((updater: React.SetStateAction<UserState | null>) => {
        setUserState(currentState => {
            const newState = typeof updater === 'function' ? updater(currentState) : updater;
            if (newState) {
                saveStateAndSync(newState);
            }
            return newState;
        });
    }, [saveStateAndSync]);

    const updateQuestProgress = useCallback((questId: string, value: number) => {
        updateAndSaveState(prevState => {
            if (!prevState) return null;

            let xpGained = 0;
            const newQuests = prevState.quests.map(q => {
                if (q.id === questId && q.progress < q.goal) {
                    const newProgress = Math.min(q.progress + value, q.goal);
                    if (newProgress >= q.goal && q.progress < q.goal) {
                        xpGained += q.xp;
                    }
                    return { ...q, progress: newProgress };
                }
                return q;
            });
            
            if (xpGained === 0 && newQuests.every((q, i) => q.progress === prevState.quests[i].progress)) {
                return prevState; // No change
            }

            let newLevel = prevState.level;
            let newXp = prevState.xp + xpGained;
            let xpForNextLevel = XP_PER_LEVEL * newLevel;

            while (newXp >= xpForNextLevel) {
                newXp -= xpForNextLevel;
                newLevel++;
                xpForNextLevel = XP_PER_LEVEL * newLevel;
            }
            
            return { ...prevState, quests: newQuests, xp: newXp, level: newLevel };
        });
    }, [updateAndSaveState]);


    const handleToggleTracking = useCallback((questId: string) => {
        const isStopping = activeTrackingQuestId === questId;

        if (questWatchIdRef.current) {
            navigator.geolocation.clearWatch(questWatchIdRef.current);
            questWatchIdRef.current = null;
        }
        lastQuestPositionRef.current = null;

        if (isStopping) {
            setActiveTrackingQuestId(() => null);
        } else {
            setActiveTrackingQuestId(questId);
            questWatchIdRef.current = navigator.geolocation.watchPosition(
                (position) => {
                    if (lastQuestPositionRef.current) {
                        const distanceIncrement = haversineDistance(lastQuestPositionRef.current.coords, position.coords);
                        updateQuestProgress(questId, distanceIncrement);
                    }
                    lastQuestPositionRef.current = position;
                },
                (error) => {
                    console.error("Geolocation Error:", error.message);
                    setActiveTrackingQuestId(currentId => {
                        if (currentId === questId) { // Check if we are still tracking this quest
                           if(questWatchIdRef.current) navigator.geolocation.clearWatch(questWatchIdRef.current);
                           questWatchIdRef.current = null;
                           return null;
                        }
                        return currentId;
                    });
                },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
            );
        }
    }, [activeTrackingQuestId, updateQuestProgress]);
    
    const handleCompleteQuestionnaire = (initialState: UserState) => {
        updateAndSaveState(initialState);
    };

    useEffect(() => {
        try {
            const savedState = localStorage.getItem("soloLevelingUserState");
            if (savedState) {
                const parsedState: UserState = JSON.parse(savedState);
                const today = new Date().toISOString().split('T')[0];
                const lastLoginDay = new Date(parsedState.lastLogin).toISOString().split('T')[0];

                if (today !== lastLoginDay) {
                    setLoadingText("GENERATING NEW DAILY QUESTS...");
                    const generateNewQuests = async () => {
                        const prompt = `The user '${parsedState.name}' (Level ${parsedState.level}, Difficulty ${parsedState.difficulty}) requires new daily quests. Generate 3 suitable quests.`;
                        const schema = {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    id: { type: Type.STRING },
                                    title: { type: Type.STRING },
                                    description: { type: Type.STRING },
                                    xp: { type: Type.INTEGER },
                                    type: { type: Type.STRING, description: "Either 'static' or 'distance'." },
                                    goal: { type: Type.NUMBER },
                                }
                            }
                        };
                        const newQuestsData = await getAiResponse(prompt, schema);
                        const freshQuests = newQuestsData?.map((q: any) => ({ ...q, progress: 0 })) || [];
                        
                        updateAndSaveState({
                            ...parsedState,
                            quests: freshQuests,
                            lastLogin: new Date().toISOString(),
                            dailyDistance: 0,
                            dailySteps: 0
                        });
                        setIsLoading(false);
                    };
                    generateNewQuests();
                } else {
                    setUserState(parsedState);
                    setIsLoading(false);
                }
            } else {
                setIsLoading(false);
            }
        } catch (e) {
            console.error("Failed to load state, resetting.", e);
            localStorage.removeItem("soloLevelingUserState");
            setIsLoading(false);
        }
    }, [updateAndSaveState]);
    
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (userStateRef.current) {
                saveStateAndSync(userStateRef.current);
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [saveStateAndSync]);

    useEffect(() => {
        if (userState) {
            if (prevLevelRef.current && userState.level > prevLevelRef.current) {
                setNotification(`LEVEL UP! REACHED LEVEL ${userState.level}`);
            }
            prevLevelRef.current = userState.level;
        }
    }, [userState]);


    if (isLoading) return <Loader text={loadingText} />;
    
    if (!userState) return <Questionnaire onComplete={handleCompleteQuestionnaire} />;

    return (
        <>
            {notification && (
                 <LevelUpNotification level={userState.level} onAcknowledge={() => setNotification(null)} />
            )}
             {showSync && <div className="sync-indicator">[SYSTEM SYNC]</div>}

            {view === 'dashboard' && <Dashboard userState={userState} onUpdateQuest={updateQuestProgress} setView={setView} onToggleTracking={handleToggleTracking} activeTrackingQuestId={activeTrackingQuestId} />}
            {view === 'skills' && <SkillsPage skills={userState.skills} setView={setView} />}
        </>
    );
};

const container = document.getElementById('root');
if(container){
    const root = createRoot(container);
    root.render(<App />);
}