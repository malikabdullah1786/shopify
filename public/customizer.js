document.addEventListener('DOMContentLoaded', () => {
    // This is a basic injection. A Theme App Extension would be better.
    // It would find the main product form and inject the customizer there.
    const productForm = document.querySelector('form[action="/cart/add"]');
    const customizerContainer = document.getElementById('customizer-container');

    if (productForm && customizerContainer) {
        productForm.prepend(customizerContainer);
    } else {
        console.warn('Shopify Product Form not found. Customizer may not appear in the right place.');
    }

    const textInput = document.getElementById('text-input');
    const imageUpload = document.getElementById('image-upload');
    const previewText = document.getElementById('preview-text');
    const previewImage = document.getElementById('preview-image');
    const addToCartButton = document.getElementById('add-to-cart');
    const previewCanvas = document.getElementById('preview-canvas');

    let customText = '';

    textInput.addEventListener('input', (event) => {
        customText = event.target.value;
        previewText.textContent = customText;
    });

    imageUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewImage.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    addToCartButton.addEventListener('click', () => {
        // Dynamically find the variant ID from the product form
        const variantIdInput = productForm.querySelector('[name="id"]');
        const variantId = variantIdInput ? variantIdInput.value : null;

        if (!variantId) {
            alert('Could not find product variant ID. Cannot add to cart.');
            console.error('Variant ID input not found in product form.');
            return;
        }

        // Use html2canvas to capture the design
        html2canvas(previewCanvas).then(canvas => {
            const designDataUrl = canvas.toDataURL('image/png');

            const properties = {
                '_custom_text': customText,
                '_custom_design': designDataUrl // Send the base64 image data
            };

            const formData = {
                'items': [{
                    'id': variantId,
                    'quantity': 1,
                    'properties': properties
                }]
            };

            fetch('/cart/add.js', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            })
            .then(response => response.json())
            .then(data => {
                console.log('Item added to cart:', data);
                alert('Customized product added to cart!');
                // Optionally, redirect to the cart page
                // window.location.href = '/cart';
            })
            .catch((error) => {
                console.error('Error adding to cart:', error);
                alert('There was an error adding the product to the cart.');
            });
        });
    });
});