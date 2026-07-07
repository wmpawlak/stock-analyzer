import { useEffect, useState } from 'react';
import {
  LIVE_DATA_CHANGED_EVENT,
  readStoredResolvedLiveData,
} from '../utils/liveData.js';

const useLiveData = () => {
  const [liveData, setLiveData] = useState(() => readStoredResolvedLiveData());

  useEffect(() => {
    const refreshLiveData = () => setLiveData(readStoredResolvedLiveData());

    window.addEventListener('storage', refreshLiveData);
    window.addEventListener(LIVE_DATA_CHANGED_EVENT, refreshLiveData);

    return () => {
      window.removeEventListener('storage', refreshLiveData);
      window.removeEventListener(LIVE_DATA_CHANGED_EVENT, refreshLiveData);
    };
  }, []);

  return liveData;
};

export default useLiveData;
