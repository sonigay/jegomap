const API_URL = process.env.REACT_APP_API_URL || 'https://port-0-jegomap-m9sqvpptbf26e8e5.sel4.cloudtype.app';

// 프론트엔드 캐싱 시스템
const clientCache = new Map();
const CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5분

const clientCacheUtils = {
  // 캐시에 데이터 저장
  set: (key, data, ttl = CLIENT_CACHE_TTL) => {
    const now = Date.now();
    clientCache.set(key, {
      data,
      timestamp: now,
      ttl: now + ttl
    });
    
    // localStorage에도 저장 (브라우저 새로고침 시에도 유지)
    try {
      localStorage.setItem(`cache_${key}`, JSON.stringify({
        data,
        timestamp: now,
        ttl: now + ttl
      }));
    } catch (error) {
      console.warn('localStorage 저장 실패:', error);
    }
  },
  
  // 캐시에서 데이터 가져오기
  get: (key) => {
    // 메모리 캐시에서 먼저 확인
    const memoryItem = clientCache.get(key);
    if (memoryItem) {
      const now = Date.now();
      if (now <= memoryItem.ttl) {
        return memoryItem.data;
      } else {
        clientCache.delete(key);
      }
    }
    
    // localStorage에서 확인
    try {
      const storedItem = localStorage.getItem(`cache_${key}`);
      if (storedItem) {
        const item = JSON.parse(storedItem);
        const now = Date.now();
        if (now <= item.ttl) {
          // 메모리 캐시에도 저장
          clientCache.set(key, item);
          return item.data;
        } else {
          localStorage.removeItem(`cache_${key}`);
        }
      }
    } catch (error) {
      console.warn('localStorage 읽기 실패:', error);
    }
    
    return null;
  },
  
  // 캐시 삭제
  delete: (key) => {
    clientCache.delete(key);
    try {
      localStorage.removeItem(`cache_${key}`);
    } catch (error) {
      console.warn('localStorage 삭제 실패:', error);
    }
  },
  
  // 캐시 정리
  cleanup: () => {
    const now = Date.now();
    
    // 메모리 캐시 정리
    for (const [key, item] of clientCache.entries()) {
      if (now > item.ttl) {
        clientCache.delete(key);
      }
    }
    
    // localStorage 정리
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cache_')) {
          const storedItem = localStorage.getItem(key);
          if (storedItem) {
            const item = JSON.parse(storedItem);
            if (now > item.ttl) {
              localStorage.removeItem(key);
            }
          }
        }
      }
    } catch (error) {
      console.warn('localStorage 정리 실패:', error);
    }
  }
};

// 주기적 캐시 정리 (5분마다)
setInterval(() => {
  clientCacheUtils.cleanup();
}, 5 * 60 * 1000);

// 전역 객체로 노출 (디버깅용)
if (typeof window !== 'undefined') {
  window.clientCacheUtils = clientCacheUtils;
}

export async function fetchData(includeShipped = true, timestamp = null) {
  // 타임스탬프가 있으면 캐시 무효화
  const cacheKey = timestamp ? `stores_data_${includeShipped}_${timestamp}` : `stores_data_${includeShipped}`;
  
  // 타임스탬프가 없는 경우에만 캐시 확인
  if (!timestamp) {
    const cachedData = clientCacheUtils.get(cacheKey);
    if (cachedData) {
      console.log('캐시된 매장 데이터 사용');
      return { success: true, data: cachedData };
    }
  }
  
  try {
    console.log(`서버에서 매장 데이터 요청 중... (includeShipped: ${includeShipped})`);
    const startTime = Date.now();
    
    const response = await fetch(`${API_URL}/api/stores?includeShipped=${includeShipped}`);
    const data = await response.json();
    
    const fetchTime = Date.now() - startTime;
    console.log(`매장 데이터 요청 완료: ${fetchTime}ms, 받은 매장 수: ${data.length}개`);
    
    console.log('\n=== 서버 응답 데이터 전체 구조 ===');
    console.log('매장 데이터 예시:', data[0]);

    // inventory 필드를 phoneData로 변환
    const processedData = data.map(store => {
      // inventory 데이터를 phoneData 배열로 변환
      let phoneData = [];
      
      if (store.inventory && typeof store.inventory === 'object') {
        // 각 모델에 대해
        Object.entries(store.inventory).forEach(([model, colorData]) => {
          // 각 색상에 대해
          if (typeof colorData === 'object' && colorData !== null) {
            Object.entries(colorData).forEach(([color, quantity]) => {
              // quantity가 있는 경우에만 추가
              if (quantity && quantity > 0) {
                phoneData.push({
                  N: store.name,    // 매장명
                  F: model,         // 모델명
                  G: color,         // 색상
                  quantity: Number(quantity)  // 수량
                });
              }
            });
          }
        });
      }

      if (store.name === "승텔레콤(인천부평)") {
        console.log('\n=== 승텔레콤 매장 데이터 변환 ===');
        console.log('원본 데이터:', {
          매장명: store.name,
          inventory: store.inventory
        });
        console.log('변환된 phoneData:', phoneData);
        console.log('phoneData 항목 수:', phoneData.length);
      }

      // phoneCount 계산 (모든 모델의 수량 합계)
      const phoneCount = phoneData.reduce((sum, item) => sum + (item.quantity || 0), 0);

      return {
        ...store,
        phoneData,
        phoneCount,
        hasInventory: phoneCount > 0
      };
    });

    // 재고 현황 요약
    console.log('\n=== 재고 현황 요약 ===');
    const summary = processedData
      .filter(store => store.phoneCount > 0)
      .map(store => ({
        매장명: store.name,
        재고수량: store.phoneCount,
        재고상세: store.phoneData.map(item => ({
          모델명: item.F,
          색상: item.G,
          수량: item.quantity
        }))
      }));
    
    console.log(JSON.stringify(summary, null, 2));

    // 캐시에 저장
    clientCacheUtils.set(cacheKey, processedData);
    
    const totalTime = Date.now() - startTime;
    console.log(`전체 처리 완료: ${totalTime}ms`);

    return { success: true, data: processedData };
  } catch (error) {
    console.error('데이터 가져오기 오류:', error);
    console.error('에러 상세:', {
      메시지: error.message,
      스택: error.stack
    });
    return { success: false, error };
  }
}

export async function fetchModels() {
  const cacheKey = 'models_data';
  
  // 캐시에서 먼저 확인
  const cachedData = clientCacheUtils.get(cacheKey);
  if (cachedData) {
    console.log('캐시된 모델 데이터 사용');
    return { success: true, data: cachedData };
  }
  
  try {
    console.log('서버에서 모델 데이터 요청 중...');
    const startTime = Date.now();
    
    const response = await fetch(`${API_URL}/api/models`);
    const data = await response.json();
    
    const fetchTime = Date.now() - startTime;
    console.log(`모델 데이터 요청 완료: ${fetchTime}ms`);
    console.log('서버로부터 받은 모델 데이터:', data);

    // 캐시에 저장
    clientCacheUtils.set(cacheKey, data);
    
    const totalTime = Date.now() - startTime;
    console.log(`전체 처리 완료: ${totalTime}ms`);

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching models:', error);
    return { success: false, error };
  }
}

/**
 * 대리점 정보를 가져오는 함수
 * @returns {Promise<Array>} 대리점 정보 배열
 */
export const fetchAgentData = async () => {
  const cacheKey = 'agents_data';
  
  // 캐시에서 먼저 확인
  const cachedData = clientCacheUtils.get(cacheKey);
  if (cachedData) {
    console.log('캐시된 대리점 데이터 사용');
    return cachedData;
  }
  
  try {
    console.log('서버에서 대리점 데이터 요청 중...');
    const startTime = Date.now();
    
    const response = await fetch(`${API_URL}/api/agents`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to fetch agent data');
    }
    
    const data = await response.json();
    
    const fetchTime = Date.now() - startTime;
    console.log(`대리점 데이터 요청 완료: ${fetchTime}ms`);
    
    // 캐시에 저장
    clientCacheUtils.set(cacheKey, data);
    
    const totalTime = Date.now() - startTime;
    console.log(`전체 처리 완료: ${totalTime}ms`);
    
    return data;
  } catch (error) {
    console.error('Error fetching agent data:', error);
    return [];
  }
};

// 캐시 관리 함수들
export const cacheManager = {
  // 캐시 상태 확인
  getStatus: () => {
    const now = Date.now();
    const validItems = Array.from(clientCache.entries()).filter(([key, item]) => now <= item.ttl);
    return {
      memory: {
        total: clientCache.size,
        valid: validItems.length,
        expired: clientCache.size - validItems.length
      },
      localStorage: (() => {
        try {
          let cacheCount = 0;
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cache_')) {
              cacheCount++;
            }
          }
          return { total: cacheCount };
        } catch (error) {
          return { total: 0, error: error.message };
        }
      })()
    };
  },
  
  // 캐시 정리
  cleanup: () => {
    clientCacheUtils.cleanup();
    console.log('클라이언트 캐시 정리 완료');
  },
  
  // 특정 캐시 삭제
  delete: (key) => {
    clientCacheUtils.delete(key);
    console.log(`캐시 삭제 완료: ${key}`);
  },
  
  // 전체 캐시 삭제
  clearAll: () => {
    clientCache.clear();
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cache_')) {
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.warn('localStorage 전체 삭제 실패:', error);
    }
    console.log('전체 캐시 삭제 완료');
  }
}; 