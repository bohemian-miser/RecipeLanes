'use client';
import { useState } from 'react';

export default function Home() {
  const [show, setShow] = useState(false);

  return (
    <main>
      <button onClick={() => setShow(true)}>Click Me</button>
      {show && <div id="hello-text">Hello</div>}
    </main>
  );
}