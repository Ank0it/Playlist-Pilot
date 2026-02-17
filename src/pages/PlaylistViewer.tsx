import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SkipForward, SkipBack, Search, Clock, List, ArrowLeft, Home, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

interface Video {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
}

interface PlaylistData {
  title: string;
  description: string;
  channelTitle: string;
  videos: Video[];
}

interface WatchProgress {
  videoId: string;
  currentTime: number;
  duration: number;
  completed: boolean;
}

interface PlaylistHistoryEntry {
  playlistId: string;
  title: string;
  channelTitle: string;
  url: string;
  viewedAt: string;
}

const HISTORY_KEY = 'playlist-history';

interface PlaylistApiResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
    };
  }>;
}

interface PlaylistItemsResponse {
  nextPageToken?: string;
  items?: Array<{
    contentDetails?: {
      videoId?: string;
    };
    snippet?: {
      resourceId?: {
        videoId?: string;
      };
    };
  }>;
}

interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: {
        default?: { url?: string };
        medium?: { url?: string };
      };
    };
    contentDetails?: {
      duration?: string;
    };
  }>;
}

const buildUrl = (base: string, params: Record<string, string | undefined>) => {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.append(key, value);
  });
  return url.toString();
};

const fetchJson = async <T>(url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({} as { error?: { message?: string } }));
    const apiMessage = (errorBody as any)?.error?.message;
    throw new Error(apiMessage || `YouTube API error (${response.status})`);
  }
  return response.json() as Promise<T>;
};

const formatIsoDuration = (duration: string) => {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const fetchPlaylistItems = async (playlistId: string) => {
  const items: NonNullable<PlaylistItemsResponse['items']> = [];
  let pageToken: string | undefined;

  do {
    const url = buildUrl('https://www.googleapis.com/youtube/v3/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50',
      pageToken,
      key: YOUTUBE_API_KEY,
    });

    const data = await fetchJson<PlaylistItemsResponse>(url);
    if (data.items) {
      items.push(...data.items);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
};

const fetchVideosById = async (videoIds: string[]) => {
  const videos: Record<string, Video> = {};

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const url = buildUrl('https://www.googleapis.com/youtube/v3/videos', {
      part: 'contentDetails,snippet',
      id: chunk.join(','),
      key: YOUTUBE_API_KEY,
    });

    const data = await fetchJson<VideosResponse>(url);
    data.items?.forEach((item) => {
      const duration = formatIsoDuration(item.contentDetails?.duration || 'PT0S');
      videos[item.id] = {
        id: item.id,
        title: item.snippet?.title || 'Untitled video',
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
        duration,
        description: item.snippet?.description || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: item.snippet?.publishedAt || '',
      };
    });
  }

  return videoIds
    .map((id) => videos[id])
    .filter((video): video is Video => Boolean(video));
};

const fetchPlaylistFromYouTube = async (playlistId: string): Promise<PlaylistData> => {
  if (!YOUTUBE_API_KEY) {
    throw new Error('Missing VITE_YOUTUBE_API_KEY. Add it to your .env to fetch playlists.');
  }

  const playlistResponse = await fetchJson<PlaylistApiResponse>(
    buildUrl('https://www.googleapis.com/youtube/v3/playlists', {
      part: 'snippet',
      id: playlistId,
      key: YOUTUBE_API_KEY,
    })
  );

  const playlistSnippet = playlistResponse.items?.[0]?.snippet;
  if (!playlistSnippet) {
    throw new Error('Playlist not found or is private.');
  }

  const playlistItems = await fetchPlaylistItems(playlistId);
  const videoIds = playlistItems
    .map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
    .filter((id): id is string => Boolean(id));

  if (videoIds.length === 0) {
    throw new Error('No videos found in this playlist.');
  }

  const videos = await fetchVideosById(videoIds);

  return {
    title: playlistSnippet.title || 'Untitled playlist',
    description: playlistSnippet.description || '',
    channelTitle: playlistSnippet.channelTitle || '',
    videos,
  };
};

// Declare YouTube API types
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

const PlaylistViewer = () => {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, WatchProgress>>({});
  const [history, setHistory] = useState<PlaylistHistoryEntry[]>([]);
  const [navVisible, setNavVisible] = useState(true);
  const hideNavTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const playerRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();

  // YouTube Player API integration
  useEffect(() => {
    // Load YouTube Player API
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Track video progress automatically
  useEffect(() => {
    if (!playlist || !playlist.videos[currentVideoIndex]) return;

    const currentVideo = playlist.videos[currentVideoIndex];
    let progressInterval: NodeJS.Timeout;
    let player: any = null;

    const initializePlayer = () => {
      if (window.YT && window.YT.Player && playerRef.current) {
        // Find the iframe inside the container
        const iframe = playerRef.current.querySelector('iframe');
        if (iframe) {
          player = new window.YT.Player(iframe, {
            events: {
              onStateChange: (event: any) => {
                if (event.data === window.YT.PlayerState.PLAYING) {
                  // Start tracking progress
                  progressInterval = setInterval(() => {
                    if (player && player.getCurrentTime && player.getDuration) {
                      const currentTime = player.getCurrentTime();
                      const duration = player.getDuration();
                      
                      if (duration > 0) {
                        setProgress(prev => ({
                          ...prev,
                          [currentVideo.id]: {
                            videoId: currentVideo.id,
                            currentTime,
                            duration,
                            completed: currentTime / duration > 0.9 // 90% watched = completed
                          }
                        }));
                      }
                    }
                  }, 1000);
                } else {
                  // Pause tracking
                  if (progressInterval) {
                    clearInterval(progressInterval);
                  }
                }

                // Auto-advance when video ends
                if (event.data === window.YT.PlayerState.ENDED) {
                  // Mark as completed
                  setProgress(prev => ({
                    ...prev,
                    [currentVideo.id]: {
                      videoId: currentVideo.id,
                      currentTime: player?.getDuration() || 0,
                      duration: player?.getDuration() || 0,
                      completed: true
                    }
                  }));

                  // Auto-advance to next video
                  setTimeout(() => {
                    if (currentVideoIndex < playlist.videos.length - 1) {
                      setCurrentVideoIndex(currentVideoIndex + 1);
                    }
                  }, 1000);
                }
              }
            }
          });
        }
      }
    };

    // Initialize player after a short delay to ensure iframe is loaded
    const timeout = setTimeout(initializePlayer, 1000);

    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      clearTimeout(timeout);
    };
  }, [playlist, currentVideoIndex]);

  // Load progress from localStorage
  useEffect(() => {
    const savedProgress = localStorage.getItem('youtube-playlist-progress');
    if (savedProgress) {
      setProgress(JSON.parse(savedProgress));
    }
  }, []);

  // Load playlist history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to parse playlist history', error);
      }
    }
  }, []);

  // Auto-hide navbar after inactivity; show on interaction
  useEffect(() => {
    const handleActivity = () => {
      setNavVisible(true);
      if (hideNavTimeout.current) {
        clearTimeout(hideNavTimeout.current);
      }
      hideNavTimeout.current = setTimeout(() => setNavVisible(false), 4000);
    };

    handleActivity();

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('scroll', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      if (hideNavTimeout.current) {
        clearTimeout(hideNavTimeout.current);
      }
    };
  }, []);

  // Save progress to localStorage
  useEffect(() => {
    localStorage.setItem('youtube-playlist-progress', JSON.stringify(progress));
  }, [progress]);

  const extractPlaylistId = (url: string) => {
    const regex = /[?&]list=([^#&?]*)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const upsertHistoryEntry = (entry: PlaylistHistoryEntry) => {
    setHistory((prev) => {
      const filtered = prev.filter((item) => item.playlistId !== entry.playlistId);
      const next = [entry, ...filtered].slice(0, 5);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  };

  const loadPlaylist = async (playlistId: string, sourceUrl?: string) => {
    setIsLoading(true);
    try {
      const data = await fetchPlaylistFromYouTube(playlistId);
      setPlaylist(data);
      setCurrentVideoIndex(0);

      const historyEntry: PlaylistHistoryEntry = {
        playlistId,
        title: data.title,
        channelTitle: data.channelTitle,
        url: sourceUrl || `https://www.youtube.com/playlist?list=${playlistId}`,
        viewedAt: new Date().toISOString(),
      };
      upsertHistoryEntry(historyEntry);
      
      toast({
        title: "Playlist loaded successfully!",
        description: `Found ${data.videos.length} videos`
      });
    } catch (error) {
      console.error('Error fetching playlist:', error);
      const description = error instanceof Error ? error.message : 'Please check the URL and try again';
      toast({
        title: "Failed to load playlist",
        description,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchPlaylist = async () => {
    if (!playlistUrl.trim()) {
      toast({
        title: "Please enter a playlist URL",
        description: "Paste a YouTube playlist URL to get started",
        variant: "destructive"
      });
      return;
    }

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
      toast({
        title: "Invalid playlist URL",
        description: "Please enter a valid YouTube playlist URL",
        variant: "destructive"
      });
      return;
    }

    await loadPlaylist(playlistId, playlistUrl.trim());
  };

  const handleResumePlaylist = async (entry: PlaylistHistoryEntry) => {
    setPlaylistUrl(entry.url);
    await loadPlaylist(entry.playlistId, entry.url);
  };

  const getVideoProgress = (videoId: string) => {
    return progress[videoId] || { videoId, currentTime: 0, duration: 0, completed: false };
  };

  const getPlaylistProgress = () => {
    if (!playlist) return 0;
    const completedVideos = playlist.videos.filter(video => 
      getVideoProgress(video.id).completed
    ).length;
    return (completedVideos / playlist.videos.length) * 100;
  };

  const formatDuration = (duration: string) => {
    return duration;
  };

  const selectVideo = (index: number) => {
    setCurrentVideoIndex(index);
  };

  const markVideoAsCompleted = (videoId: string) => {
    setProgress(prev => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        videoId,
        currentTime: prev[videoId]?.currentTime ?? 0,
        duration: prev[videoId]?.duration ?? 0,
        completed: true
      }
    }));
  };

  const toggleVideoCompletion = (videoId: string) => {
    setProgress(prev => {
      const currentProgress = prev[videoId] || { videoId, currentTime: 0, duration: 0, completed: false };
      return {
        ...prev,
        [videoId]: {
          ...currentProgress,
          completed: !currentProgress.completed
        }
      };
    });
  };

  const nextVideo = () => {
    if (playlist && currentVideoIndex < playlist.videos.length - 1) {
      // Mark current video as completed when moving to next
      markVideoAsCompleted(playlist.videos[currentVideoIndex].id);
      setCurrentVideoIndex(currentVideoIndex + 1);
    }
  };

  const previousVideo = () => {
    if (currentVideoIndex > 0) {
      setCurrentVideoIndex(currentVideoIndex - 1);
    }
  };

  const handleHome = () => {
    setPlaylist(null);
    setPlaylistUrl('');
    setCurrentVideoIndex(0);
    navigate('/');
  };

  const canGoBack = typeof window !== 'undefined' ? window.history.length > 1 : false;

  const renderNavbar = () => (
    <div
      className={`sticky top-0 z-20 backdrop-blur bg-background/70 border-b border-border transition-all duration-500 ${
        navVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            disabled={!canGoBack}
            className="bg-white/5 hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleHome}
            className="bg-white/5 hover:bg-white/10"
          >
            <Home className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 ml-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-accent to-primary grid place-items-center text-white font-bold shadow-glow">
              PP
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Playlist Pilot</p>
              <p className="text-xs text-muted-foreground leading-tight">Track & resume playlists</p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-end gap-2 overflow-hidden">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Recent</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pr-2" style={{ scrollbarWidth: 'none' }}>
            {history.length === 0 && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">No recent playlists yet</span>
            )}
            {history.map((entry) => (
              <Button
                key={entry.playlistId}
                variant="ghost"
                size="sm"
                className="bg-white/5 hover:bg-white/10 text-foreground/90 border border-border/60 rounded-full max-w-xs truncate"
                onClick={() => handleResumePlaylist(entry)}
              >
                <span className="truncate">{entry.title || entry.playlistId}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (!playlist) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        {renderNavbar()}
        <div className="p-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h1 className="text-5xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                Playlist Pilot
              </h1>
              <p className="text-xl text-muted-foreground">
                Track your progress and resume any playlist instantly
              </p>
            </div>

            <Card className="bg-gradient-card border-border shadow-card p-8">
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <Search className="h-6 w-6 text-accent" />
                  <h2 className="text-2xl font-semibold">Enter Playlist URL</h2>
                </div>
                
                <div className="flex gap-3">
                  <Input
                    placeholder="https://www.youtube.com/playlist?list=..."
                    value={playlistUrl}
                    onChange={(e) => setPlaylistUrl(e.target.value)}
                    className="text-lg py-3 bg-secondary border-border"
                    onKeyDown={(e) => e.key === 'Enter' && handleFetchPlaylist()}
                  />
                  <Button 
                    onClick={handleFetchPlaylist}
                    disabled={isLoading}
                    className="px-8 py-3 text-lg bg-gradient-primary hover:shadow-glow transition-smooth"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                        Loading...
                      </>
                    ) : (
                      'Load Playlist'
                    )}
                  </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                  <p>• Paste any YouTube playlist URL</p>
                  <p>• Track your viewing progress automatically</p>
                  <p>• Resume where you left off</p>
                </div>
              </div>
            </Card>

            {history.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-3 text-foreground flex items-center gap-2">
                  <History className="h-4 w-4" /> Recent playlists
                </h3>
                <div className="flex flex-wrap gap-3">
                  {history.map((entry) => (
                    <Button
                      key={entry.playlistId}
                      variant="outline"
                      className="bg-white/5 hover:bg-white/10 border-border/60"
                      onClick={() => handleResumePlaylist(entry)}
                    >
                      <div className="text-left">
                        <p className="font-medium leading-tight truncate max-w-xs">{entry.title || 'Playlist'}</p>
                        <p className="text-xs text-muted-foreground leading-tight truncate max-w-xs">{entry.channelTitle}</p>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentVideo = playlist.videos[currentVideoIndex];

  return (
    <div className="min-h-screen bg-background">
      {renderNavbar()}
      <div className="flex min-h-[calc(100vh-64px)]">
        {/* Sidebar - Playlist */}
        <div className="w-96 bg-gradient-card border-r border-border overflow-hidden flex flex-col">
          <div className="p-6 border-b border-border">
            <h2 className="text-xl font-bold mb-2 line-clamp-2">{playlist.title}</h2>
            <p className="text-sm text-muted-foreground mb-3">{playlist.channelTitle}</p>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overall Progress</span>
                <span className="text-accent font-medium">{Math.round(getPlaylistProgress())}%</span>
              </div>
              <Progress value={getPlaylistProgress()} className="h-2" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-3">
              {playlist.videos.map((video, index) => {
                const videoProgress = getVideoProgress(video.id);
                const isActive = index === currentVideoIndex;
                
                return (
                  <Card
                    key={video.id}
                    className={`cursor-pointer transition-smooth hover:bg-video-card-hover ${
                      isActive ? 'bg-accent/10 border-accent' : 'bg-video-card border-border'
                    }`}
                    onClick={() => selectVideo(index)}
                  >
                    <div className="p-4">
                      <div className="flex gap-3">
                        <div className="relative flex-shrink-0">
                          <img
                            src={video.thumbnail}
                            alt={video.title}
                            className="w-24 h-16 object-cover rounded"
                          />
                          <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                            {formatDuration(video.duration)}
                          </div>
                          {videoProgress.completed && (
                            <div className="absolute top-1 left-1 bg-progress-watched text-white text-xs px-1 rounded">
                              ✓
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <h3 className={`font-medium line-clamp-2 text-sm ${
                            isActive ? 'text-accent' : 'text-foreground'
                          }`}>
                            {video.title}
                          </h3>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{formatDuration(video.duration)}</span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleVideoCompletion(video.id);
                              }}
                              className={`text-xs px-2 py-1 rounded transition-colors ${
                                videoProgress.completed 
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {videoProgress.completed ? '✓ Done' : 'Mark Done'}
                            </button>
                          </div>
                          
                          {videoProgress.currentTime > 0 && !videoProgress.completed && (
                            <div className="mt-2">
                              <Progress 
                                value={(videoProgress.currentTime / videoProgress.duration) * 100} 
                                className="h-1" 
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content - Video Player */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-black relative" ref={playerRef}>
            <div className="aspect-video w-full h-full flex items-center justify-center">
              <iframe
                src={`https://www.youtube.com/embed/${currentVideo.id}?autoplay=1&rel=0&enablejsapi=1`}
                className="w-full h-full"
                frameBorder="0"
                allow="autoplay; encrypted-media"
                allowFullScreen
                title={currentVideo.title}
              />
            </div>
          </div>

          <div className="p-6 bg-gradient-card border-t border-border">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold mb-2 line-clamp-2">{currentVideo.title}</h1>
                <p className="text-muted-foreground">{currentVideo.channelTitle}</p>
              </div>
              
              <div className="flex items-center gap-3 ml-6">
                <Button
                  variant="outline"
                  onClick={() => toggleVideoCompletion(currentVideo.id)}
                  className={getVideoProgress(currentVideo.id).completed ? 'bg-green-100 text-green-700' : ''}
                >
                  {getVideoProgress(currentVideo.id).completed ? '✓ Completed' : 'Mark as Done'}
                </Button>
                
                <Button
                  variant="outline"
                  size="icon"
                  onClick={previousVideo}
                  disabled={currentVideoIndex === 0}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                
                <Button
                  variant="outline"
                  size="icon"
                  onClick={nextVideo}
                  disabled={currentVideoIndex === playlist.videos.length - 1}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Video {currentVideoIndex + 1} of {playlist.videos.length}</span>
              <span className="flex items-center gap-1">
                <List className="h-4 w-4" />
                {playlist.title}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaylistViewer;
