## Components

Components in this dir will be auto-registered and on-demand, powered by [unplugin-vue-components](https://github.com/unplugin/unplugin-vue-components).

Components can be shared in all views.

### Form controls

The shared form system keeps options, popup and side-panel controls visually and semantically consistent:

- `FormField` owns the label, hint, error state and generated control ID.
- `BaseInput`, `BaseSelect` and `BaseTextarea` consume `FormField` context automatically.
- `BaseCheckbox`, `ToggleSwitch` and `RangeControl` cover distinct boolean and numeric interactions.
- `BaseButton` provides primary, secondary, ghost, warning and danger command states.

Prefer these components over page-level native controls. For security-sensitive fields that validate on commit, such as AI endpoints, bind `model-value` one-way and handle the forwarded native `change` event.

### Icons

You can use icons from almost any icon sets by the power of [Iconify](https://iconify.design/).

It will only bundle the icons you use. Check out [unplugin-icons](https://github.com/unplugin/unplugin-icons) for more details.
