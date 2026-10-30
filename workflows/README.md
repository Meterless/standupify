# Workflows

**Any ComfyUI API workflow you put in this folder becomes a one-click recipe in Standupify.** You can also drop the file on the Engines sheet in the app.

Make one in ComfyUI: build the graph, then use **Workflow › Export (API)**. Standupify finds the prompt, the start frame, the seed and the output on its own. For exact control, write placeholders into the workflow before you export it:

| Placeholder | Becomes |
|---|---|
| `{{prompt}}` | the bit's shot description and camera move |
| `{{negative}}` | Standupify's negative prompt |
| `{{image}}` | the bit's still, uploaded as the start frame (clips only) |

A workflow that saves a video (`SaveVideo`, `VHS_VideoCombine`, `SaveAnimatedWEBP`…) is a **clip** recipe. One that saves images is a **still** recipe.

`examples/` holds every built-in recipe exported this way (`npm run export:workflows` regenerates them). Open them in ComfyUI to see exactly what Standupify runs, or copy one up into this folder and remix it.
