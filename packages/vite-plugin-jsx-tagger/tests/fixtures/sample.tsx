import React from 'react';

interface SampleProps {
  title: string;
  description?: string;
}

export function Sample({ title, description }: SampleProps) {
  return (
    <div className="sample-container">
      <header>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </header>
      <main>
        <section>
          <span>Content goes here</span>
        </section>
      </main>
      <footer>
        <small>Footer text</small>
      </footer>
    </div>
  );
}

export function SelfClosingElements() {
  return (
    <form>
      <input type="text" placeholder="Name" />
      <br />
      <img src="/avatar.png" alt="Avatar" />
      <hr />
    </form>
  );
}

export function ConditionalRendering({ show }: { show: boolean }) {
  return (
    <div>
      {show && <span>Visible when show is true</span>}
      {show ? <p>Yes</p> : <p>No</p>}
    </div>
  );
}

export function ListRendering({ items }: { items: { id: string; name: string }[] }) {
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>
          <strong>{item.name}</strong>
        </li>
      ))}
    </ul>
  );
}
