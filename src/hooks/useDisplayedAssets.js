import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import useLiveData from './useLiveData.js';
import { getLiveAssetsFromLiveData } from '../utils/liveData.js';

const useDisplayedAssets = () => {
  const assets = useSelector((state) => state.portfolio.assets);
  const liveData = useLiveData();

  const liveAssets = useMemo(() => getLiveAssetsFromLiveData(liveData), [liveData]);

  return {
    assets: liveAssets.length > 0 ? liveAssets : assets,
    isUsingLiveAssets: liveAssets.length > 0,
  };
};

export default useDisplayedAssets;
