import { useEffect, useRef, useState } from "react";
import type { StoryMoment } from "./storyMoments";

const STORY_REFRESH_MILLISECONDS = 20_000;

const pickRandom = (moments: StoryMoment[]) =>
  moments[Math.floor(Math.random() * moments.length)] ?? null;

export function useFeaturedMoment(moments: StoryMoment[]) {
  const momentsRef = useRef(moments);
  const [featured, setFeatured] = useState<StoryMoment | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFeatured(pickRandom(momentsRef.current));
    }, STORY_REFRESH_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    momentsRef.current = moments;
    setFeatured((current) => {
      if (!moments.length) return null;
      return current ?? pickRandom(moments);
    });
  }, [moments]);

  return featured;
}
