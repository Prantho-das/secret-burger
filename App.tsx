import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { AppState, OfferPayload } from './types';
import { hashPassword, formatBytes } from './utils/helpers';
import { SecretBurgerLogo, TransmitIcon, LockIcon, ClipboardIcon, DownloadIcon, CheckCircleIcon, UploadCloudIcon, DocumentIcon } from './components/Icons';

const CHUNK_SIZE = 16384; // 16 KB
const STUN_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>('idle');
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [offer, setOffer] = useState<string | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    
    const [progress, setProgress] = useState(0);
    const [transferredBytes, setTransferredBytes] = useState(0);
    const [receivedFileInfo, setReceivedFileInfo] = useState<{name: string, size: number} | null>(null);
    const [receivedFileChunks, setReceivedFileChunks] = useState<ArrayBuffer[]>([]);
    const downloadUrl = useRef<string | null>(null);
    
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const dataChannel = useRef<RTCDataChannel | null>(null);
    
    const resetState = () => {
        setAppState('idle');
        setFile(null);
        setPassword('');
        setError(null);
        setOffer(null);
        setIsCopied(false);
        setProgress(0);
        setTransferredBytes(0);
        setReceivedFileInfo(null);
        setReceivedFileChunks([]);
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
        downloadUrl.current = null;
        peerConnection.current?.close();
        peerConnection.current = null;
        dataChannel.current?.close();
        dataChannel.current = null;
        window.location.hash = '';
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setError(null);
        }
    };
    
    const createPeerConnection = useCallback(() => {
        const pc = new RTCPeerConnection(STUN_SERVERS);

        pc.onicecandidate = (event) => {
            if (event.candidate === null) {
                if (pc.localDescription) {
                    if(appState === 'generatingOffer') {
                        const payload: OfferPayload = {
                            sdp: pc.localDescription,
                            fileName: file!.name,
                            fileSize: file!.size,
                        };
                        (async () => {
                            if (password) {
                                payload.passwordHash = await hashPassword(password);
                            }
                            const encodedOffer = btoa(JSON.stringify(payload));
                            setOffer(encodedOffer);
                            setAppState('awaitingAnswer');
                        })();
                    } else if (appState === 'generatingAnswer') {
                        const encodedAnswer = btoa(JSON.stringify(pc.localDescription));
                        setOffer(encodedAnswer);
                    }
                }
            }
        };

        pc.onconnectionstatechange = () => {
            if(pc.connectionState === 'connected') {
                setAppState('transferring');
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                setError("Connection failed. Please try again.");
                setAppState('error');
            }
        };

        pc.ondatachannel = (event) => {
            const channel = event.channel;
            dataChannel.current = channel;
            setupDataChannel(channel);
        };
        
        peerConnection.current = pc;
        return pc;
    }, [appState, file, password]);

    const setupDataChannel = (channel: RTCDataChannel) => {
        channel.onopen = () => {
             if (file) { // Sender side
                setAppState('transferring');
                sendFileInChunks();
            }
        };

        channel.onmessage = (event) => {
            const data = event.data;
            if (typeof data === 'string') {
                try {
                  const msg = JSON.parse(data);
                  if (msg.type === 'done') {
                      const receivedBlob = new Blob(receivedFileChunks);
                      downloadUrl.current = URL.createObjectURL(receivedBlob);
                      setAppState('transferComplete');
                  }
                } catch(e) { /* Not a JSON message, probably file data */ }
            } else {
                setReceivedFileChunks(prev => [...prev, data]);
                const newTransferred = transferredBytes + data.byteLength;
                setTransferredBytes(newTransferred);
                if (receivedFileInfo) {
                    setProgress(Math.round((newTransferred / receivedFileInfo.size) * 100));
                }
            }
        };
    };

    const sendFileInChunks = () => {
        if (!file || !dataChannel.current) return;
        const fileReader = new FileReader();
        let offset = 0;

        fileReader.onload = () => {
            const chunk = fileReader.result as ArrayBuffer;
            if (dataChannel.current?.readyState === 'open') {
                dataChannel.current.send(chunk);
                offset += chunk.byteLength;
                setTransferredBytes(offset);
                setProgress(Math.round((offset / file.size) * 100));

                if (offset < file.size) {
                    readSlice(offset);
                } else {
                    dataChannel.current.send(JSON.stringify({ type: 'done' }));
                    setAppState('transferComplete');
                }
            }
        };
        
        const readSlice = (o: number) => {
            const slice = file.slice(o, o + CHUNK_SIZE);
            fileReader.readAsArrayBuffer(slice);
        };

        readSlice(0);
    };

    const handleCreateLink = async () => {
        if (!file) {
            setError('Please select a file first.');
            return;
        }
        setAppState('generatingOffer');
        const pc = createPeerConnection();
        const dc = pc.createDataChannel('fileTransfer');
        dataChannel.current = dc;
        setupDataChannel(dc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
    };
    
    const handleConnect = async (answerStr: string) => {
        try {
            const answer = JSON.parse(atob(answerStr));
            if (peerConnection.current) {
                await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
                setAppState('connecting');
            }
        } catch (e) {
            setError('Invalid counter-signal format. Please try again.');
            console.error(e);
        }
    };
    
    const processOffer = useCallback(async (payload: OfferPayload) => {
        try {
            setReceivedFileInfo({ name: payload.fileName, size: payload.fileSize });
            const pc = createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            setAppState('generatingAnswer');
        } catch (e) {
            setError('Failed to process transmission. The link might be invalid.');
            setAppState('error');
            console.error(e);
        }
    }, [createPeerConnection]);
    
    useEffect(() => {
        const hash = window.location.hash.substring(1);
        if (hash && appState === 'idle') {
            try {
                const payload: OfferPayload = JSON.parse(atob(hash));
                setAppState('processingOffer');
                if (payload.passwordHash) {
                    localStorage.setItem('offerPayload', JSON.stringify(payload));
                    setAppState('awaitingPassword');
                } else {
                    processOffer(payload);
                }
            } catch (e) {
                setError('Invalid transmission link.');
                setAppState('error');
            }
        }
    }, [appState, processOffer]);
    
    const handlePasswordSubmit = async (pass: string) => {
        const payloadStr = localStorage.getItem('offerPayload');
        if (!payloadStr) {
            setError('Transmission data not found. Please use the original link.');
            setAppState('error');
            return;
        }
        const payload: OfferPayload = JSON.parse(payloadStr);
        const hashedPass = await hashPassword(pass);
        if (hashedPass === payload.passwordHash) {
            localStorage.removeItem('offerPayload');
            processOffer(payload);
        } else {
            setError('Incorrect secret code.');
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    const renderIdle = () => (
        <div className="w-full max-w-lg space-y-4 text-center">
            <SecretBurgerLogo className="w-32 h-32 mx-auto" />
            <h1 className="text-4xl font-bold tracking-wider">SECRET BURGER</h1>
            <p className="text-lg text-gray-400">Securely Transmit Your Secret Recipes.</p>
            
            <div className="p-6 bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700 space-y-6">
                <div>
                    <label htmlFor="file-upload" className="block text-sm font-medium text-gray-400 mb-2 uppercase tracking-widest">1. Recipe File</label>
                    <div className="mt-2 flex justify-center rounded-lg border-2 border-dashed border-gray-600 px-6 py-10 hover:border-indigo-500 transition-colors">
                        <div className="text-center">
                            <UploadCloudIcon className="mx-auto h-12 w-12 text-gray-500" />
                            <div className="mt-4 flex text-sm leading-6 text-gray-400">
                                <label htmlFor="file-upload" className="relative cursor-pointer rounded-md font-semibold text-indigo-400 hover:text-indigo-300">
                                    <span>Select file</span>
                                    <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} />
                                </label>
                                <p className="pl-1">or drag and drop</p>
                            </div>
                            {file ? 
                                <p className="text-xs leading-5 text-gray-300 mt-2">{file.name} ({formatBytes(file.size)})</p>
                                : <p className="text-xs leading-5 text-gray-500">Peer-to-peer transfer</p>
                            }
                        </div>
                    </div>
                </div>
    
                <div>
                     <label htmlFor="password" className="block text-sm font-medium text-gray-400 mb-2 uppercase tracking-widest">2. Secret Code (Optional)</label>
                    <div className="relative">
                        <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                        <input type="password" name="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter secret code..." className="w-full bg-gray-900 border border-gray-700 rounded-md pl-10 pr-4 py-2 focus:ring-indigo-500 focus:border-indigo-500" />
                    </div>
                </div>
                 {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                <div className="pt-2">
                    <button onClick={handleCreateLink} disabled={!file} className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-md transition-colors duration-200 text-lg">
                        <TransmitIcon className="w-6 h-6"/>
                        Generate Secure Transmission
                    </button>
                </div>
            </div>
        </div>
    );
    
    const renderAwaitingAnswer = () => (
        <div className="w-full max-w-lg space-y-6 text-center">
            <h2 className="text-3xl font-bold tracking-wider">COMM LINK GENERATED</h2>
            <p className="text-gray-400">Send this secure link to your fellow agent. It contains the transmission frequency.</p>
            <div className="relative p-4 bg-gray-800 rounded-lg">
                <input type="text" readOnly value={`${window.location.href}#${offer}`} className="w-full bg-gray-900 border border-gray-700 rounded-md p-2 pr-12 text-gray-300"/>
                <button onClick={() => copyToClipboard(`${window.location.href}#${offer}`)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-white">
                    <ClipboardIcon className="w-6 h-6"/>
                </button>
            </div>
            {isCopied && <p className="text-green-400">Transmission link copied!</p>}
            
            <p className="text-gray-400">Once your agent responds, paste their counter-signal below to establish the connection.</p>
            <form onSubmit={(e) => { e.preventDefault(); handleConnect((e.target as any).elements.answer.value); }}>
                <textarea name="answer" placeholder="Paste counter-signal here..." required className="w-full h-32 bg-gray-800 border border-gray-700 rounded-md p-2 text-gray-300 focus:ring-indigo-500 focus:border-indigo-500"></textarea>
                <button type="submit" className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-200">Establish Connection</button>
            </form>
        </div>
    );
    
    const renderReceiverPassword = () => (
        <div className="w-full max-w-md text-center space-y-4">
            <LockIcon className="w-16 h-16 mx-auto text-yellow-400" />
            <h2 className="text-3xl font-bold tracking-wider">AUTHENTICATION REQUIRED</h2>
            <p className="text-gray-400 my-4">This transmission is protected. Enter the secret code to decrypt the recipe.</p>
            <form onSubmit={e => { e.preventDefault(); handlePasswordSubmit((e.target as any).elements.password.value); }}>
                <input name="password" type="password" placeholder="Enter secret code" required className="w-full bg-gray-800 border border-gray-700 rounded-md p-3 text-center focus:ring-indigo-500 focus:border-indigo-500" />
                {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                <button type="submit" className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-200">DECRYPT</button>
            </form>
        </div>
    );

    const renderGeneratingAnswer = () => (
        <div className="w-full max-w-lg space-y-6 text-center">
            <h2 className="text-3xl font-bold tracking-wider">COUNTER-SIGNAL READY</h2>
            <p className="text-gray-400">Incoming recipe: <span className="font-semibold text-indigo-400">{receivedFileInfo?.name}</span> ({formatBytes(receivedFileInfo?.size || 0)})</p>
            <p className="text-gray-400">Copy the counter-signal below and transmit it back to the original agent.</p>
             <div className="relative p-4 bg-gray-800 rounded-lg">
                <textarea readOnly value={offer || ''} className="w-full h-32 bg-gray-900 border border-gray-700 rounded-md p-2 pr-12 text-gray-300 resize-none"/>
                <button onClick={() => copyToClipboard(offer!)} className="absolute right-2 top-2 p-2 text-gray-400 hover:text-white">
                    <ClipboardIcon className="w-6 h-6"/>
                </button>
            </div>
            {isCopied && <p className="text-green-400">Counter-signal copied!</p>}
            <p className="text-lg font-semibold animate-pulse text-yellow-400">Awaiting secure handshake...</p>
        </div>
    );

    const renderProgress = () => (
        <div className="w-full max-w-lg text-center">
            <h2 className="text-3xl font-bold mb-4 tracking-wider">{appState === 'transferring' ? 'TRANSMITTING RECIPE...' : 'TRANSMISSION COMPLETE!'}</h2>
            <div className="p-8 bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700">
                <div className="flex items-center gap-4 mb-4">
                    <DocumentIcon className="w-10 h-10 text-indigo-400 flex-shrink-0"/>
                    <div className="text-left overflow-hidden">
                        <p className="font-semibold truncate">{file?.name || receivedFileInfo?.name}</p>
                        <p className="text-sm text-gray-400">{formatBytes(file?.size || receivedFileInfo?.size || 0)}</p>
                    </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                    <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all duration-300" style={{width: `${progress}%`}}></div>
                </div>
                <p className="mt-4 text-gray-400">{progress}% complete</p>
                <p className="text-sm text-gray-500">{formatBytes(transferredBytes)} / {formatBytes(file?.size || receivedFileInfo?.size || 0)}</p>
                
                {appState === 'transferComplete' && !file && downloadUrl.current && (
                    <a href={downloadUrl.current} download={receivedFileInfo?.name} className="mt-8 w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-200">
                        <DownloadIcon className="w-5 h-5"/>
                        Download Recipe
                    </a>
                )}
                {appState === 'transferComplete' && (
                    <>
                        <div className="flex justify-center items-center gap-2 mt-8 text-green-400">
                            <CheckCircleIcon className="w-8 h-8"/>
                            <p className="text-lg">Recipe Acquired!</p>
                        </div>
                        <button onClick={resetState} className="mt-4 text-indigo-400 hover:underline">Transmit Another Recipe</button>
                    </>
                )}
            </div>
        </div>
    );
    
    const renderSpinner = (text: string) => (
        <div className="flex flex-col items-center gap-4">
            <svg className="animate-spin h-10 w-10 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-lg text-gray-400 tracking-wider">{text}</p>
        </div>
    );

    const renderContent = () => {
        switch (appState) {
            case 'idle': return renderIdle();
            case 'generatingOffer': return renderSpinner('Generating secure comms...');
            case 'awaitingAnswer': return renderAwaitingAnswer();
            case 'processingOffer': return renderSpinner('Decrypting transmission...');
            case 'awaitingPassword': return renderReceiverPassword();
            case 'generatingAnswer': return renderGeneratingAnswer();
            case 'connecting': return renderSpinner('Establishing secure channel...');
            case 'transferring':
            case 'transferComplete':
                return renderProgress();
            case 'error':
                return <div className="text-center">
                    <h2 className="text-2xl text-red-500">A TRANSMISSION ERROR OCCURRED</h2>
                    <p className="text-gray-400 mt-2">{error}</p>
                    <button onClick={resetState} className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md">Try Again</button>
                </div>
            default: return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 font-mono">
            <main className="w-full flex items-center justify-center">
                {renderContent()}
            </main>
            <footer className="absolute bottom-4 text-gray-600 text-sm tracking-wider">
                All transmissions are secured with end-to-end DTLS encryption.
            </footer>
        </div>
    );
};

export default App;