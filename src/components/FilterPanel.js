import React, { useCallback } from 'react';
import './FilterPanel.css';
import { 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  Typography,
  Slider,
  Box,
  Paper,
  Grid
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import ColorLensIcon from '@mui/icons-material/ColorLens';

const marks = [
  { value: 1000, label: '1km' },
  { value: 5000, label: '5km' },
  { value: 10000, label: '10km' },
  { value: 20000, label: '20km' },
  { value: 30000, label: '30km' },
  { value: 50000, label: '50km' }
];

function FilterPanel({ 
  models, 
  colorsByModel, 
  selectedModel, 
  selectedColor, 
  selectedRadius,
  onModelSelect, 
  onColorSelect, 
  onRadiusSelect,
  isAgentMode = false
}) {
  const handleModelChange = (event, newValue) => {
    console.log('모델 선택:', newValue);
    onModelSelect(newValue || '');
  };

  const handleColorChange = (event) => {
    const newValue = event.target.value;
    console.log('색상 선택:', newValue);
    onColorSelect(newValue);
  };

  const handleRadiusChange = useCallback((event, newValue) => {
    if (event.type === 'mouseup' || event.type === 'touchend') {
      onRadiusSelect(newValue);
    }
  }, [onRadiusSelect]);

  return (
    <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
      <Typography variant="h8" sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
        <TuneIcon sx={{ mr: 1 }} />
        필터 설정
      </Typography>

      {/* 모델 및 색상 선택 */}
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', md: 'row' },
        gap: 2,
        width: '100%',
        mb: isAgentMode ? 0 : 3
      }}>
        {/* 모델 검색 */}
        <Box sx={{ flexGrow: 1, minWidth: { xs: '100%', md: '60%' } }}>
          <Autocomplete
            value={selectedModel}
            onChange={handleModelChange}
            options={Array.isArray(models) ? models : []}
            renderInput={(params) => (
              <TextField
                {...params}
                label="모델 검색"
                variant="outlined"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />
                }}
              />
            )}
          />
        </Box>

        {/* 색상 선택 */}
        <Box sx={{ flexGrow: 1, minWidth: { xs: '100%', md: '40%' } }}>
          <FormControl fullWidth size="small">
            <InputLabel>색상 선택</InputLabel>
            <Select
              value={selectedColor || ''}
              onChange={handleColorChange}
              label="색상 선택"
              disabled={!selectedModel}
              startAdornment={<ColorLensIcon color="action" sx={{ mr: 1 }} />}
            >
              <MenuItem value="">전체</MenuItem>
              {selectedModel && colorsByModel[selectedModel]?.map((color) => (
                <MenuItem key={color} value={color}>
                  {color}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* 검색 반경 - 관리자 모드가 아닐 때만 표시 */}
      {!isAgentMode && (
        <Box sx={{ width: '100%' }}>
          <Typography variant="body2" sx={{ mb: 1, display: 'flex', alignItems: 'center', fontWeight: 'medium' }}>
            <LocationOnIcon sx={{ mr: 1, fontSize: 20 }} />
            검색 반경: {(selectedRadius/1000).toFixed(1)}km
          </Typography>
          <Slider
            value={selectedRadius}
            onChange={handleRadiusChange}
            onChangeCommitted={handleRadiusChange}
            min={1000}
            max={50000}
            step={1000}
            marks={marks}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `${(value/1000).toFixed(1)}km`}
          />
        </Box>
      )}
    </Paper>
  );
}

export default FilterPanel; 