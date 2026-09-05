# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

You can attach images up to 10 MB. On servers that support file uploads, you can also
attach videos, text files, PDFs, ZIP archives, and other files. Each file can be up to the limit advertised
by the server, capped at 50 MB. Each message can contain up to eight attachments in total. Files
upload directly to the environment, where your agent can read, copy, or edit them by their file path.

On desktop, select a sent PDF or HTML attachment to open it in the file viewer, or use the
download button beside it to save a copy. Other attached files download when selected.

On desktop, if you reload before a file finishes uploading, the draft keeps the file's name
and shows **Attach again** next to it. Attach the file again or remove it, then send.

On desktop, an existing thread settles its composer into a single-line resting state when
the composer loses focus. At wider sizes, scrolling the conversation also rests a focused composer,
except when scrolling toward the end while already there. When the thread-context strip has room,
the model and mode controls stay available beside the thread context; otherwise they return when the
composer is focused. Focus the composer or start typing to expand it again. The conversation keeps
the expanded composer's space clear above its last message while the composer rests, so expanding it
again never covers what you scrolled to. New-thread layouts keep the full composer. **Settings → General → Collapse composer** chooses which triggers rest it:
**On unfocus**, **On scroll**, both, or neither. With neither selected the composer stays expanded.

At phone-sized web or desktop window widths, existing threads animate between their compact and
expanded layouts. Up to three image attachments remain visible in either resting layout, followed
by a count when more are attached. At wider sizes, videos, files, and other draft context remain
visible at their natural height; the phone-sized compact row reveals those details when expanded.

## Model defaults

T3 Code remembers the last provider, model, and model options you selected and reuses that
selection for new threads. A model configured in a project's settings overrides the remembered
selection for that project; resetting the project setting returns it to the remembered selection.

Model options shown as provider defaults remain display values until you choose them in T3 Code.
T3 Code only sends options you selected explicitly, so an unset reasoning level or service tier can
still come from the provider's own configuration.

## Quote an assistant response

On desktop, select text in an assistant response, then choose **Cite in composer** from the
menu that appears when you release the selection. This inserts an inline quote chip at your cursor
and opens an optional comment bubble beside the selected text; press `Enter` or choose **Save** to
attach the comment, or leave it blank to keep just the quote. You can type before and after the
chip, such as a quote followed by "what do you mean?". A selection must stay within one response
and fit in 8,000 characters.

The chip shows your comment when it has one, or a short quote preview otherwise. Use the pencil
button to add or change the comment, and the remove button to delete the quote and its comment from
the draft. Copying, reloading, and restoring a [stashed prompt](#prompt-stash) keep each comment
with its quote, and sending tells the agent which words were quoted and which comment you wrote.
The quoted text and comment count toward the message limit.

Select a chip in the composer or a sent message to open the source thread, scroll to the response,
and highlight the quoted passage — including in older history. The
highlight pulses, holds for a moment, then fades on its own; press `Escape` to stop the navigation
or clear it early. If the source is unavailable or its text has changed, the saved quote stays
readable and T3 Code shows a warning.

Mobile shows the full saved quote and its comment in sent messages. It does not offer
**Cite in composer** or navigation to a quote's source.

## Images and videos in messages

On desktop, hover over a preview to see its full file path or original URL. Right-click
to copy that reference, save the image or video, or copy an image to the clipboard. The video
player's built-in controls can download a video too. If the player cannot decode a video, its error message
offers a link to open the source in the browser. Workspace media also offers **Copy relative
path** and **Open in file viewer**. These actions are available in expanded previews too.

Use Markdown image syntax to embed either kind of media:

```markdown
![Screenshot](/tmp/screenshot.png)
![Recording](/tmp/recording.mp4)
[Open recording](/tmp/recording.mp4)
```

Relative paths resolve from the thread's workspace. Absolute paths and `file://` links refer to
the environment's machine, even when you connect remotely or use your phone. Supported media
can live outside the workspace, including in Downloads or `/tmp`.

T3 Code serves the original file without adding it to attachment storage. If that file is moved
or deleted, its preview can no longer load from the environment. A browser or device may still
have a cached copy. Supported video formats and codecs depend on the browser or device.

Bare paths in ordinary prose and paths inside code blocks stay text. Raw HTML `<video>` tags
are not supported; use the Markdown embed syntax above.

## Files outside the workspace

When an agent links to a file it wrote outside the workspace, such as a Markdown report in
`/tmp`, select the link to open it in the file viewer. The viewer shows the file read-only, with
rendered Markdown available as usual; it cannot edit files outside the workspace. The workspace
file tree stays hidden because it does not describe the open file. HTML and PDF files outside the
workspace open the same way as ones inside it. Because such a file is served on its own, an HTML
page outside the workspace cannot load scripts, styles, or images from files beside it.

## HTML and PDF files in the file viewer

On desktop, the file viewer shows HTML and PDF files as a rendered page. Use the
source toggle in the viewer's header to switch an HTML file between the page and its markup; the
choice persists like the rendered-Markdown toggle. A link to a line always opens the source. HTML
runs in an isolated frame with no access to your T3 Code session. On desktop, the integrated
browser remains available from the same header for a full browser view.

## Changing projects

On desktop, changing the project from a new thread keeps the current environment when that
project exists there. If it does not, T3 Code selects another environment that has the project.

## Notices above the composer

On desktop, loading and syncing statuses fill the available banner width beside the
stash tab. Task progress appears above the composer, while the timeline's working timer shows
only elapsed time.

Loading, syncing, and server-update icons are static. Live tool labels do not shimmer.

On desktop, additional notices peek out above the attached banner. Hover over the peek
to reveal them, or focus **Show other notices** with `Tab` and press `Enter` or `Space`. Press
`Escape` to close the stack and return focus to that control. On a touchscreen, tap the peek to
open the stack. Interacting with the attached banner or composer does not open the stack.

## Prompt stash

Use the default shortcut, `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux, to stash the current
prompt and its attachments after all file uploads finish. When the composer is empty and the stash
has one entry, press the shortcut again to restore it. The shortcut opens the stash menu if there
are multiple entries or the entry's images are still saving. You can also open the menu from the
stash badge. Stashes that contain files must be restored in the environment where those files were
uploaded. Stashed files stay uploaded on the server for 24 hours. If you restore an entry after
that, the file comes back with **Attach again** next to it. Attach the file again or remove it, then
send.

## Voice input on iPhone

The first use can download Apple's speech model and needs a network connection. Later transcription
works offline for that language. A recording can be up to five minutes long. Canceling voice input,
leaving the screen, or an audio interruption discards the new recording and keeps the existing draft
and attachments. T3 Code deletes the local audio file after transcription or cancellation. It sends
only the normal message text when you submit the draft.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

In a thread with prior conversation context, send `/compact` to reduce context usage. Desktop also offer this action from the context meter, and the work log records token counts when the provider reports them.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

A skill token runs the skill wherever it sits in your message. T3 Code sends it to each provider in
the form that provider runs, so the text before and after the token is kept. Skills that only you may
start, and never the agent on its own, work the same way. A skill you switched off in the provider's
settings does not appear in either menu.

Provider commands such as `/compact` only run when they open the message, so the `/` menu offers
them only there. T3 Code's own commands, such as `/model` and `/plan`, and skills stay available on
any line.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
