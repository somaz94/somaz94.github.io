/* assets/k8s-inspector/samples.js
 * The manifest behind the "Load a sample manifest" button — hand-maintained.
 *
 * It is deliberately not a clean manifest. A first visit that lints green shows
 * nothing about what the tool does, so this one plants one instance of most v1
 * rules: a removed apiVersion, an untagged image, no resource requests or
 * limits, no probes, a privileged container, and replicas > 1 with no
 * PodDisruptionBudget anywhere in the input.
 *
 * Every value here is fictional. Do not paste a real cluster's manifest into
 * this file — it ships to every visitor.
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
