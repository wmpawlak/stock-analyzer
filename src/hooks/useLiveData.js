import { useEffect, useState } from 'react';
import {
  LIVE_DATA_CHANGED_EVENT,
  readStoredLiveData,
} from '../utils/liveData.js';

const useLiveData = () => {
  const [liveData, setLiveData] = useState(() => readStoredLiveData());

  useEffect(() => {
    const refreshLiveData = () => setLiveData(readStoredLiveData());

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
