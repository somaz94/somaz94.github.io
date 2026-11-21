/* assets/k8s-inspector/samples.js
 * The "Load a sample manifest" input. Deliberately dirty: a sample that lints
 * green shows nothing about what the tool does.
 *
 * Every value is fictional. Never paste a real cluster's manifest here — it
 * ships to every visitor.
 */
window.KI_SAMPLES = {
  default: [
    'apiVersion: extensions/v1beta1',
    'kind: Deployment',
    'metadata:',
    '  name: web',
    '  namespace: demo',
    'spec:',
    '  replicas: 3',
    '  selector:',
    '    matchLabels:',
    '      app: web',
    '  template:',
    '    metadata:',
    '      labels:',
    '        app: web',
    '    spec:',
    '      containers:',
    '        - name: web',
    '          image: registry.example.com/demo/web',
    '          ports:',
    '            - containerPort: 8080',
    '          securityContext:',
    '            privileged: true',
    '---',
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: web',
    '  namespace: demo',
    'spec:',
    '  selector:',
    '    app: web',
    '  ports:',
    '    - port: 80',
    '      targetPort: 8080',
    ''
  ].join('\n')
};
