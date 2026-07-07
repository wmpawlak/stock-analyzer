import { useMemo } from 'react';
import useLiveData from './useLiveData.js';
import {
  getLiveAssetsFromLiveData,
  readStoredDummyData,
  readStoredLiveData,
} from '../utils/liveData.js';

const useDisplayedAssets = () => {
  const liveData = useLiveData();

  const displayedAssets = useMemo(() => getLiveAssetsFromLiveData(liveData), [liveData]);
  const liveAssets = getLiveAssetsFromLiveData(readStoredLiveData());
  const dummyAssets = getLiveAssetsFromLiveData(readStoredDummyData());
  const isUsingLiveAssets = liveAssets.length > 0;
  const isUsingDummyAssets = !isUsingLiveAssets && dummyAssets.length > 0;

  return {
    assets: displayedAssets,
    isUsingLiveAssets,
    isUsingDummyAssets,
    sourceLabel: isUsingLiveAssets ? 'Dane Live' : (isUsingDummyAssets ? 'Dane dummy' : ''),
  };
};

export default useDisplayedAssets;
