import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  getLiveAssetsFromLiveData,
  LIVE_DATA_CHANGED_EVENT,
  readStoredLiveData,
} from '../utils/liveData.js';

const useDisplayedAssets = () => {
  const assets = useSelector((state) => state.portfolio.assets);
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

  const liveAssets = useMemo(() => getLiveAssetsFromLiveData(liveData), [liveData]);

  return {
    assets: liveAssets.length > 0 ? liveAssets : assets,
    isUsingLiveAssets: liveAssets.length > 0,
  };
};

export default useDisplayedAssets;
