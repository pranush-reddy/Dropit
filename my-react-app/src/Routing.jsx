import React from 'react';
import { Routes, Route } from 'react-router-dom';
import App from './App';
import Load from './Load';

function Routing(){
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/load" element={<Load />} />
    </Routes>
  );
}

export default Routing;
