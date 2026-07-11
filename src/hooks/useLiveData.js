import { useEffect, useState } from 'react';
import {
  LIVE_DATA_CHANGED_EVENT,
  readStoredResolvedLiveData,
} from '../utils/liveData.js';
import { PERSISTENT_STATE_CHANGED_EVENT } from '../utils/persistentStorage.js';

const useLiveData = () => {
  const [liveData, setLiveData] = useState(() => readStoredResolvedLiveData());

  useEffect(() => {
    const refreshLiveData = () => setLiveData(readStoredResolvedLiveData());

    window.addEventListener('storage', refreshLiveData);
    window.addEventListener(LIVE_DATA_CHANGED_EVENT, refreshLiveData);
    window.addEventListener(PERSISTENT_STATE_CHANGED_EVENT, refreshLiveData);

    return () => {
      window.removeEventListener('storage', refreshLiveData);
      window.removeEventListener(LIVE_DATA_CHANGED_EVENT, refreshLiveData);
      window.removeEventListener(PERSISTENT_STATE_CHANGED_EVENT, refreshLiveData);
    };
  }, []);

  return liveData;
};

export default useLiveData;
