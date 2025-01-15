---
date: 2025-01-02 16:00:00
layout: post
title: How Web Browsers Work
description: Understanding the internal working mechanism of web browsers, from DNS lookup to page rendering.
image: https://res.cloudinary.com/dkcm26aem/image/upload/v1736933243/web_zt24if.png
optimized_image: https://res.cloudinary.com/dkcm26aem/image/upload/v1736933243/web_zt24if.png
category: cs
author: somaz
tags:
  - browser
  - web
  - networking
  - rendering
---

## 🎯 Overview
Let's explore how web browsers work internally, from the moment a user enters a URL until the page is displayed.

### 📝 Summary

1. User accesses website through browser (www.a.com)
2. Browser identifies server's IP address through DNS
3. Browser and server perform 3-Way Handshake
4. Browser sends HTTP Request to server
5. Server sends HTTP Response to browser
6. Browser parses HTML to create DOM Tree
7. Upon encountering Style tags, pauses DOM creation to parse CSS and create CSSOM Tree
8. When encountering script tags, passes control to JavaScript engine to parse and create AST
9. Creates Render Tree by combining DOM + CSSOM
10. This process is called Construction
11. Rendering engine performs Layout on Render Tree nodes
12. UI backend draws UI by traversing Render Tree nodes (Painting)
13. Finally, composes nodes in Render Tree in order (Composition)
14. This process is called Operation
15. Displays final result to web user

### 📊 Flow Chart
<div style="width: 70%; margin: auto;">
{% mermaid %}
graph TD;
    A[🌐 User accesses website www.a.com] --> B[📡 DNS Lookup: Resolve IP address];
    B --> C[🔗 3-Way Handshake SYN → SYN/ACK → ACK];
    C --> D[📨 Send HTTP Request to Server];
    D --> E[📥 Receive HTTP Response];
    E --> F[🛠️ Parse HTML → Create DOM Tree];
    F --> G{🎨 Style tag detected?};
    G -- Yes --> H[🖌️ Parse CSS → Create CSSOM Tree];
    H --> F;
    G -- No --> I{📜 Script tag detected?};
    I -- Yes --> J[⚙️ Parse JavaScript → Create AST];
    J --> F;
    I -- No --> K[📝 Merge DOM + CSSOM → Render Tree];
    K --> L[📐 Layout: Position Elements];
    L --> M[🖼️ Painting: Render UI];
    M --> N[📊 Composition: Organize Layers z-index];
    N --> O[👀 Display Rendered Page to User];
    %% Additional Explanation
    E -.-> P[⚡ Partial Rendering for Faster Display];
    P --> F;
{% endmermaid %}
</div>

### 🔍 Detailed Process

#### 🏗️ Construction Phase

- **STEP 1: Browser - DNS**
  - User enters website URL (www.a.com)
  - Browser queries DNS for host's IP address
  - DNS returns IP address (e.g., 1.1.1.1)

- **STEP 2: Browser - Server**
  - Browser connects to server with IP address using random sequence number
  - Performs 3-Way Handshake (SYN - SYN/ACK - ACK)
  - Browser sends HTTP Request
  - Server responds with HTTP Response

- **STEP 3: Browser - Parsing**
  - Browser parses received data according to W3C specifications
  - Rendering engine creates DOM Tree from HTML
  - When encountering Style tags:
    - Pauses DOM creation
    - Parses CSS to create CSSOM Tree
    - Resumes DOM creation
  - When encountering Script tags:
    - Pauses parsing
    - Passes control to JS Engine
    - Creates AST (Abstract Syntax Tree)
    - Executes JavaScript code
  - Creates Render Tree (DOM Tree + CSSOM Tree)

#### 🎨 Operation Phase

- **STEP 1: Layout**
  - Rendering engine positions Render Tree nodes correctly on screen

- **STEP 2: Painting**
  - UI Backend draws UI by traversing Render Tree nodes

- **STEP 3: Composition**
  - Arranges node layers in order (based on z-index)
  - Lower z-index elements first, followed by higher ones

### ⚠️ Additional Notes

The parsing, layout, and UI drawing processes don't wait for all data to be received from the server. For faster user experience:
- Browser starts displaying content as soon as partial data is received
- Continues this process as more data arrives
- This explains why web pages load progressively rather than all at once

### 🔑 Key Points
1. CSS is a render-blocking resource, not a parsing-blocking resource
2. JavaScript execution blocks parsing
3. Progressive rendering improves perceived performance

### 📚 Reference
- [What is DNS? - AWS](https://aws.amazon.com/ko/route53/what-is-dns/)
- [Understanding Browser Rendering](https://all-young.tistory.com/21)
- [Web Browser Architecture](https://ddangjiwon.tistory.com/138)
- [Browser Rendering Process](https://bbangson.tistory.com/87)
