let raw = "";
for await (const chunk of process.stdin) raw += chunk;
process.stdout.write(JSON.stringify({ additionalContext: JSON.parse(raw).prompt }));
